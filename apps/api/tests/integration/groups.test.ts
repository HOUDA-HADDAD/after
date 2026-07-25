import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { asUser, registerUser, type InjectResponse } from '../helpers/auth.js';

describe('groups, members and invitations', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = testPrisma();
    ({ app } = await buildTestApp());
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  /* ---- helpers ------------------------------------------------------------------------ */

  const api = (
    token: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    app.inject(
      asUser(token, {
        method,
        url: `/api/v1${url}`,
        ...(payload === undefined ? {} : { payload }),
      }),
    ) as Promise<InjectResponse>;

  /** An owner with a group, plus a joined co-host and member. */
  const makeGroupWithRoles = async () => {
    const owner = await registerUser(app);
    const created = await api(owner.token, 'POST', '/groups', { name: 'Friday Night' });
    const groupId = created.json().id as string;

    const invite = await api(owner.token, 'POST', `/groups/${groupId}/invitations`, {});
    const code = invite.json().code as string;

    const cohost = await registerUser(app);
    await api(cohost.token, 'POST', '/join', { code });
    await api(owner.token, 'PATCH', `/groups/${groupId}/members/${cohost.userId}`, {
      role: 'COHOST',
    });

    const member = await registerUser(app);
    await api(member.token, 'POST', '/join', { code });

    return { owner, cohost, member, groupId, code };
  };

  /* ---- route policy ------------------------------------------------------------------- */

  describe('route policy', () => {
    it('declares a policy for every API route', () => {
      // The plugin throws at boot when one is missing, so reaching this assertion already proves
      // it. Listing them keeps the coverage visible in review.
      expect(app.routePolicies.length).toBeGreaterThan(15);
      expect(app.routePolicies.every((route) => route.policy !== undefined)).toBe(true);
    });

    it('refuses to boot when a route omits its policy', async () => {
      await expect(
        buildTestApp({
          routes: (instance) => {
            instance.get('/api/v1/__unguarded', async () => ({ ok: true }));
          },
        }).then((built) => built.app.ready()),
      ).rejects.toThrow(/does not declare config.policy/);
    });

    it.each([
      ['GET', '/groups'],
      ['POST', '/groups'],
      ['POST', '/join'],
    ])('rejects %s %s without a session', async (method, url) => {
      const response = await app.inject({
        method: method as 'GET',
        url: `/api/v1${url}`,
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });

  /* ---- groups ------------------------------------------------------------------------- */

  describe('creating and reading groups', () => {
    it('creates a group with the creator as owner', async () => {
      const owner = await registerUser(app);

      const response = await api(owner.token, 'POST', '/groups', { name: 'Friday Night' });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        name: 'Friday Night',
        memberCount: 1,
        viewerRole: 'OWNER',
      });
    });

    it('rejects a blank or overlong name', async () => {
      const owner = await registerUser(app);

      expect((await api(owner.token, 'POST', '/groups', { name: ' ' })).statusCode).toBe(400);
      expect((await api(owner.token, 'POST', '/groups', { name: 'x'.repeat(61) })).statusCode).toBe(
        400,
      );
    });

    it('lists only the groups you belong to', async () => {
      const alice = await registerUser(app);
      const bob = await registerUser(app);

      await api(alice.token, 'POST', '/groups', { name: 'Alice one' });
      await api(alice.token, 'POST', '/groups', { name: 'Alice two' });
      await api(bob.token, 'POST', '/groups', { name: 'Bob only' });

      const response = await api(alice.token, 'GET', '/groups');

      expect(response.json().groups).toHaveLength(2);
      expect(
        (response.json().groups as { name: string }[]).map((group) => group.name).sort(),
      ).toEqual(['Alice one', 'Alice two']);
    });

    it('returns the roster with roles and punishment counters', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      const response = await api(owner.token, 'GET', `/groups/${groupId}`);
      const body = response.json();

      expect(body.memberCount).toBe(3);
      expect(body.members).toHaveLength(3);
      expect(body.members[0]).toMatchObject({ role: 'OWNER', consecutivePunishments: 0 });
    });
  });

  /* ---- the 404 rule ------------------------------------------------------------------- */

  describe('a non-member cannot tell a group exists', () => {
    it.each([
      ['GET', ''],
      ['PATCH', ''],
      ['DELETE', ''],
      ['GET', '/members'],
      ['GET', '/invitations'],
      ['POST', '/invitations'],
      ['POST', '/leave'],
    ])('returns 404 — not 403 — for %s /groups/:id%s', async (method, suffix) => {
      const { groupId } = await makeGroupWithRoles();
      const outsider = await registerUser(app);

      const response = await api(
        outsider.token,
        method as 'GET',
        `/groups/${groupId}${suffix}`,
        method === 'PATCH' ? { name: 'Hijacked' } : {},
      );

      // 403 would confirm the group exists, which is exactly what an id-prober wants to learn.
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('gives a non-member the same answer as a group that never existed', async () => {
      const { groupId } = await makeGroupWithRoles();
      const outsider = await registerUser(app);
      const nowhere = '019f9a00-0000-7000-8000-000000000000';

      const real = await api(outsider.token, 'GET', `/groups/${groupId}`);
      const fake = await api(outsider.token, 'GET', `/groups/${nowhere}`);

      expect(real.statusCode).toBe(fake.statusCode);
      expect(real.json().code).toBe(fake.json().code);
      expect(real.json().title).toBe(fake.json().title);
    });
  });

  /* ---- role enforcement over HTTP ----------------------------------------------------- */

  describe('role enforcement', () => {
    it('lets a co-host rename the group', async () => {
      const { cohost, groupId } = await makeGroupWithRoles();

      const response = await api(cohost.token, 'PATCH', `/groups/${groupId}`, { name: 'Renamed' });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Renamed');
    });

    it('stops a plain member renaming the group', async () => {
      const { member, groupId } = await makeGroupWithRoles();

      const response = await api(member.token, 'PATCH', `/groups/${groupId}`, { name: 'Nope' });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('stops a co-host deleting the group', async () => {
      const { cohost, groupId } = await makeGroupWithRoles();

      expect((await api(cohost.token, 'DELETE', `/groups/${groupId}`)).statusCode).toBe(403);
    });

    it('lets the owner delete the group, taking everything with it', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      expect((await api(owner.token, 'DELETE', `/groups/${groupId}`)).statusCode).toBe(204);
      expect(await prisma.group.count()).toBe(0);
      expect(await prisma.groupMembership.count()).toBe(0);
      expect(await prisma.invitation.count()).toBe(0);
    });

    it('stops a co-host removing another co-host', async () => {
      const { owner, cohost, member, groupId } = await makeGroupWithRoles();
      await api(owner.token, 'PATCH', `/groups/${groupId}/members/${member.userId}`, {
        role: 'COHOST',
      });

      const response = await api(
        cohost.token,
        'DELETE',
        `/groups/${groupId}/members/${member.userId}`,
      );

      expect(response.statusCode).toBe(403);
    });

    it('stops a co-host removing the owner', async () => {
      const { owner, cohost, groupId } = await makeGroupWithRoles();

      const response = await api(
        cohost.token,
        'DELETE',
        `/groups/${groupId}/members/${owner.userId}`,
      );

      expect(response.statusCode).toBe(403);
    });

    it('lets a co-host remove an ordinary member', async () => {
      const { cohost, member, groupId } = await makeGroupWithRoles();

      const response = await api(
        cohost.token,
        'DELETE',
        `/groups/${groupId}/members/${member.userId}`,
      );

      expect(response.statusCode).toBe(204);
      expect((await api(member.token, 'GET', `/groups/${groupId}`)).statusCode).toBe(404);
    });

    it('stops anyone removing themselves through the member endpoint', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      const response = await api(
        owner.token,
        'DELETE',
        `/groups/${groupId}/members/${owner.userId}`,
      );

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('CANNOT_ACT_ON_SELF');
    });

    it('stops a co-host promoting anyone', async () => {
      const { cohost, member, groupId } = await makeGroupWithRoles();

      const response = await api(
        cohost.token,
        'PATCH',
        `/groups/${groupId}/members/${member.userId}`,
        { role: 'COHOST' },
      );

      expect(response.statusCode).toBe(403);
    });

    it('refuses to change the owner’s role through the member endpoint', async () => {
      const { owner, groupId, cohost } = await makeGroupWithRoles();
      // Even the owner cannot demote themselves this way — that is what transfer is for.
      const response = await api(
        owner.token,
        'PATCH',
        `/groups/${groupId}/members/${owner.userId}`,
        { role: 'MEMBER' },
      );

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('CANNOT_ACT_ON_SELF');

      // And a co-host certainly cannot.
      expect(
        (
          await api(cohost.token, 'PATCH', `/groups/${groupId}/members/${owner.userId}`, {
            role: 'MEMBER',
          })
        ).statusCode,
      ).toBe(403);
    });

    it('returns 404 when the target is not in the group', async () => {
      const { owner, groupId } = await makeGroupWithRoles();
      const outsider = await registerUser(app);

      expect(
        (await api(owner.token, 'DELETE', `/groups/${groupId}/members/${outsider.userId}`))
          .statusCode,
      ).toBe(404);
    });
  });

  /* ---- leaving and ownership ---------------------------------------------------------- */

  describe('leaving and ownership transfer', () => {
    it('lets a member leave', async () => {
      const { member, groupId } = await makeGroupWithRoles();

      expect((await api(member.token, 'POST', `/groups/${groupId}/leave`)).statusCode).toBe(204);
      expect((await api(member.token, 'GET', `/groups/${groupId}`)).statusCode).toBe(404);
    });

    it('stops the owner leaving a group they still own', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      const response = await api(owner.token, 'POST', `/groups/${groupId}/leave`);

      // Otherwise the group is left with nobody able to run a game or forgive a punishment.
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('OWNER_CANNOT_LEAVE');
    });

    it('transfers ownership and demotes the previous owner to co-host', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();

      const response = await api(
        owner.token,
        'POST',
        `/groups/${groupId}/transfer-ownership/${member.userId}`,
      );

      expect(response.statusCode).toBe(200);

      const members = response.json().members as { userId: string; role: string }[];
      expect(members.find((row) => row.userId === member.userId)?.role).toBe('OWNER');
      // Demoted to co-host, not to member: they were running the group a moment ago.
      expect(members.find((row) => row.userId === owner.userId)?.role).toBe('COHOST');

      const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
      expect(group.ownerId).toBe(member.userId);
    });

    it('lets the former owner leave once they have transferred', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();
      await api(owner.token, 'POST', `/groups/${groupId}/transfer-ownership/${member.userId}`);

      expect((await api(owner.token, 'POST', `/groups/${groupId}/leave`)).statusCode).toBe(204);
    });

    it('never leaves the group with two owners', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();

      await api(owner.token, 'POST', `/groups/${groupId}/transfer-ownership/${member.userId}`);

      // A partial unique index enforces this, so a botched transfer would abort rather than
      // produce a group nobody can govern.
      const owners = await prisma.groupMembership.count({ where: { groupId, role: 'OWNER' } });
      expect(owners).toBe(1);
    });

    it('stops a co-host transferring ownership', async () => {
      const { cohost, member, groupId } = await makeGroupWithRoles();

      expect(
        (await api(cohost.token, 'POST', `/groups/${groupId}/transfer-ownership/${member.userId}`))
          .statusCode,
      ).toBe(403);
    });

    it('refuses a transfer to yourself', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      const response = await api(
        owner.token,
        'POST',
        `/groups/${groupId}/transfer-ownership/${owner.userId}`,
      );

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('CANNOT_ACT_ON_SELF');
    });
  });

  /* ---- invitations -------------------------------------------------------------------- */

  describe('invitations', () => {
    it('creates a code a host can share', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      const response = await api(owner.token, 'POST', `/groups/${groupId}/invitations`, {});

      expect(response.statusCode).toBe(201);
      expect(response.json().code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    });

    it('stops a plain member creating or listing codes', async () => {
      const { member, groupId } = await makeGroupWithRoles();

      expect(
        (await api(member.token, 'POST', `/groups/${groupId}/invitations`, {})).statusCode,
      ).toBe(403);
      expect((await api(member.token, 'GET', `/groups/${groupId}/invitations`)).statusCode).toBe(
        403,
      );
    });

    it('joins a group by code', async () => {
      const { code, groupId } = await makeGroupWithRoles();
      const newcomer = await registerUser(app);

      const response = await api(newcomer.token, 'POST', '/join', { code });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: groupId, viewerRole: 'MEMBER' });
    });

    it('accepts a code typed with the characters people substitute', async () => {
      const { code } = await makeGroupWithRoles();
      const newcomer = await registerUser(app);

      // O for zero, I for one — Crockford's decoding rules, applied so a misheard code still works.
      const mistyped = code.replace(/0/g, 'O').replace(/1/g, 'I').toLowerCase();

      expect((await api(newcomer.token, 'POST', '/join', { code: mistyped })).statusCode).toBe(200);
    });

    it('is idempotent for someone already in the group', async () => {
      const { code, member, groupId } = await makeGroupWithRoles();

      const response = await api(member.token, 'POST', '/join', { code });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(groupId);
      expect(await prisma.groupMembership.count({ where: { groupId } })).toBe(3);
    });

    it.each([
      ['an unknown code', 'ZZZZZZZZ'],
      ['a malformed code', 'nonsense'],
    ])('gives the same answer for %s', async (_label, code) => {
      const newcomer = await registerUser(app);

      const response = await api(newcomer.token, 'POST', '/join', { code });

      expect([400, 404]).toContain(response.statusCode);
    });

    it('reports revoked, expired and exhausted codes identically', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      const revoked = (await api(owner.token, 'POST', `/groups/${groupId}/invitations`, {})).json();
      await api(owner.token, 'DELETE', `/groups/${groupId}/invitations/${revoked.id as string}`);

      const exhausted = (
        await api(owner.token, 'POST', `/groups/${groupId}/invitations`, { maxUses: 1 })
      ).json();
      const firstJoiner = await registerUser(app);
      await api(firstJoiner.token, 'POST', '/join', { code: exhausted.code as string });

      const expired = (
        await api(owner.token, 'POST', `/groups/${groupId}/invitations`, { expiresInHours: 1 })
      ).json();
      await prisma.invitation.update({
        where: { id: expired.id as string },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const outsider = await registerUser(app);
      const responses = await Promise.all(
        [revoked.code, exhausted.code, expired.code].map((code) =>
          api(outsider.token, 'POST', '/join', { code: code as string }),
        ),
      );

      // Identical in every respect: an attacker learns nothing about which codes ever existed.
      for (const response of responses) {
        expect(response.statusCode).toBe(404);
        expect(response.json().code).toBe('INVITE_UNUSABLE');
        expect(response.json().title).toBe(responses[0]!.json().title);
      }
    });

    it('honours a use cap under concurrent redemption', async () => {
      const { owner, groupId } = await makeGroupWithRoles();
      const invitation = (
        await api(owner.token, 'POST', `/groups/${groupId}/invitations`, { maxUses: 2 })
      ).json();

      const joiners = await Promise.all([
        registerUser(app),
        registerUser(app),
        registerUser(app),
        registerUser(app),
      ]);

      const results = await Promise.all(
        joiners.map((joiner) =>
          api(joiner.token, 'POST', '/join', { code: invitation.code as string }),
        ),
      );

      // The cap is enforced by a conditional UPDATE, so four simultaneous redemptions cannot all
      // squeeze past a read-then-write check.
      expect(results.filter((response) => response.statusCode === 200)).toHaveLength(2);
      expect(await prisma.groupMembership.count({ where: { groupId } })).toBe(5);
    });

    it('excludes revoked codes from the host’s list', async () => {
      const { owner, groupId } = await makeGroupWithRoles();
      const first = (await api(owner.token, 'POST', `/groups/${groupId}/invitations`, {})).json();
      await api(owner.token, 'POST', `/groups/${groupId}/invitations`, {});

      await api(owner.token, 'DELETE', `/groups/${groupId}/invitations/${first.id as string}`);

      const listed = (await api(owner.token, 'GET', `/groups/${groupId}/invitations`)).json();
      expect(listed.invitations).toHaveLength(2);
    });

    it('refuses to revoke an invitation belonging to another group', async () => {
      const groupA = await makeGroupWithRoles();
      const groupB = await makeGroupWithRoles();

      const invitation = (
        await api(groupB.owner.token, 'POST', `/groups/${groupB.groupId}/invitations`, {})
      ).json();

      const response = await api(
        groupA.owner.token,
        'DELETE',
        `/groups/${groupA.groupId}/invitations/${invitation.id as string}`,
      );

      expect(response.statusCode).toBe(404);
    });

    it('refuses to admit someone once the group is full', async () => {
      // A dedicated app with a cap of 2, so the limit is reachable in a test.
      const { app: capped } = await buildTestApp({ env: { MAX_GROUP_MEMBERS: '2' } });
      await capped.ready();

      const call = (token: string, method: 'POST', url: string, payload: object) =>
        capped.inject(asUser(token, { method, url: `/api/v1${url}`, payload }));

      const owner = await registerUser(capped);
      const groupId = (await call(owner.token, 'POST', '/groups', { name: 'Cosy' })).json()
        .id as string;
      const code = (await call(owner.token, 'POST', `/groups/${groupId}/invitations`, {})).json()
        .code as string;

      const second = await registerUser(capped);
      expect((await call(second.token, 'POST', '/join', { code })).statusCode).toBe(200);

      const third = await registerUser(capped);
      const response = await call(third.token, 'POST', '/join', { code });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('GROUP_FULL');

      await capped.close();
    });
  });
});
