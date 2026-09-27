import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-test-app.js';
import { asUser, registerUser } from '../helpers/auth.js';
import { resetDatabase, testPrisma } from '../helpers/prisma.js';
import * as inviteCodes from '../../src/lib/invite-code.js';

describe('room and authentication regressions', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase(testPrisma());
    ({ app } = await buildTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } }));
    await app.ready();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('persists distinct codes for three rooms created concurrently and redeems each into its room', async () => {
    const owner = await registerUser(app);
    const guest = await registerUser(app);
    const responses = await Promise.all(
      ['Salon A', 'Salon B', 'Salon C'].map((name) =>
        app.inject(
          asUser(owner.token, { method: 'POST', url: '/api/v1/groups', payload: { name } }),
        ),
      ),
    );
    const codes: string[] = [];
    for (const response of responses) {
      expect(response.statusCode).toBe(201);
      const groupId = response.json<{ id: string }>().id;
      const invitations = await testPrisma().invitation.findMany({ where: { groupId } });
      expect(invitations).toHaveLength(1);
      const code = invitations[0]!.code;
      codes.push(code);
      const joined = await app.inject(
        asUser(guest.token, { method: 'POST', url: '/api/v1/join', payload: { code } }),
      );
      expect(joined.statusCode).toBe(200);
      expect(joined.json<{ id: string }>().id).toBe(groupId);
    }
    expect(new Set(codes).size).toBe(3);
  });

  it('does not charge successful logins against the failed-password IP budget', async () => {
    const user = await registerUser(app);
    const login = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '192.0.2.21',
        payload: { email: user.credentials.email, password },
      });
    for (let i = 0; i < 5; i++)
      expect((await login(user.credentials.password)).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) expect((await login('wrong')).statusCode).toBe(401);
    expect((await login('wrong')).statusCode).toBe(429);
  });

  it('resets failures after success and counts concurrent failed requests once each', async () => {
    const user = await registerUser(app);
    const login = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '192.0.2.22',
        payload: { email: user.credentials.email, password },
      });
    expect((await login('wrong')).statusCode).toBe(401);
    expect((await login(user.credentials.password)).statusCode).toBe(200);
    const replies = await Promise.all(Array.from({ length: 6 }, () => login('wrong')));
    expect(replies.filter((reply) => reply.statusCode === 401)).toHaveLength(5);
    expect(replies.filter((reply) => reply.statusCode === 429)).toHaveLength(1);
  });

  it('serializes regeneration, revokes old codes and rejects them even for members', async () => {
    const owner = await registerUser(app);
    const group = await app.groups.create(owner.userId, 'Salon');
    const initial = (await app.invitations.list(group.id, owner.userId))[0]!;
    const replacements = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.invitations.create(group.id, owner.userId, { expiresInHours: null, maxUses: null }),
      ),
    );
    expect(new Set(replacements.map((invite) => invite.code)).size).toBe(3);
    const active = await app.invitations.list(group.id, owner.userId);
    expect(active).toHaveLength(1);
    for (const old of [initial, ...replacements].filter((invite) => invite.id !== active[0]!.id)) {
      await expect(app.invitations.redeem(old.code, owner.userId)).rejects.toMatchObject({
        code: 'INVITE_UNUSABLE',
      });
    }
    expect((await app.invitations.redeem(active[0]!.code, owner.userId)).id).toBe(group.id);
  });

  it('retries collisions without leaving a partially created room', async () => {
    const owner = await registerUser(app);
    const first = await app.groups.create(owner.userId, 'Premier');
    const code = (await app.invitations.list(first.id, owner.userId))[0]!.code;
    const generate = vi.spyOn(inviteCodes, 'generateInviteCode').mockReturnValueOnce(code);
    const second = await app.groups.create(owner.userId, 'Deuxième');
    expect(generate).toHaveBeenCalledTimes(2);
    expect((await app.invitations.list(second.id, owner.userId))[0]!.code).not.toBe(code);
    generate.mockReturnValue(code);
    await expect(app.groups.create(owner.userId, 'Échec')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await testPrisma().group.count()).toBe(2);
    expect(await testPrisma().groupMembership.count()).toBe(2);
  });

  it('does not exhaust codes or duplicate memberships when the same user joins concurrently', async () => {
    const owner = await registerUser(app);
    const guest = await registerUser(app);
    const group = await app.groups.create(owner.userId, 'Salon');
    const invite = (await app.invitations.list(group.id, owner.userId))[0]!;
    const joined = await Promise.all(
      Array.from({ length: 5 }, () => app.invitations.redeem(invite.code, guest.userId)),
    );
    expect(joined.every((result) => result.id === group.id)).toBe(true);
    expect(await testPrisma().groupMembership.count({ where: { groupId: group.id } })).toBe(2);
    expect(
      (await testPrisma().invitation.findUniqueOrThrow({ where: { id: invite.id } })).useCount,
    ).toBe(1);
  });

  it('enforces capacity across concurrent redemptions', async () => {
    await app.close();
    ({ app } = await buildTestApp({ env: { MAX_GROUP_MEMBERS: '2' } }));
    await app.ready();
    const owner = await registerUser(app);
    const guests = await Promise.all([registerUser(app), registerUser(app)]);
    const group = await app.groups.create(owner.userId, 'Salon');
    const invite = (await app.invitations.list(group.id, owner.userId))[0]!;
    const results = await Promise.allSettled(
      guests.map((guest) => app.invitations.redeem(invite.code, guest.userId)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await testPrisma().groupMembership.count({ where: { groupId: group.id } })).toBe(2);
  });

  it('limits code guesses by account even across different IP addresses', async () => {
    const guest = await registerUser(app);
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({
        ...asUser(guest.token, {
          method: 'POST',
          url: '/api/v1/join',
          payload: { code: '00000000' },
        }),
        remoteAddress: `192.0.2.${String(i + 1)}`,
      });
      expect(response.statusCode).toBe(i < 10 ? 404 : 429);
    }
  });

  it('excludes exhausted and expired invitations and preserves the old code when replacement fails', async () => {
    const owner = await registerUser(app);
    const group = await app.groups.create(owner.userId, 'Salon');
    const initial = (await app.invitations.list(group.id, owner.userId))[0]!;
    vi.spyOn(inviteCodes, 'generateInviteCode').mockReturnValue(initial.code);
    await expect(
      app.invitations.create(group.id, owner.userId, { expiresInHours: null, maxUses: null }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await app.invitations.list(group.id, owner.userId)).toHaveLength(1);
    await testPrisma().invitation.update({
      where: { id: initial.id },
      data: { maxUses: 1, useCount: 1 },
    });
    expect(await app.invitations.list(group.id, owner.userId)).toHaveLength(0);
    await expect(app.invitations.redeem(initial.code, owner.userId)).rejects.toMatchObject({
      code: 'INVITE_UNUSABLE',
    });
    await testPrisma().invitation.update({
      where: { id: initial.id },
      data: { maxUses: null, expiresAt: new Date(0) },
    });
    expect(await app.invitations.list(group.id, owner.userId)).toHaveLength(0);
    await expect(app.invitations.redeem(initial.code, owner.userId)).rejects.toMatchObject({
      code: 'INVITE_UNUSABLE',
    });
  });
});
