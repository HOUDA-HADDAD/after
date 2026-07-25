import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { asUser, registerUser, type InjectResponse } from '../helpers/auth.js';

describe('punishments', () => {
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

  const makeGroupWithRoles = async () => {
    const owner = await registerUser(app);
    const groupId = (await api(owner.token, 'POST', '/groups', { name: 'Friday Night' })).json()
      .id as string;
    const code = (await api(owner.token, 'POST', `/groups/${groupId}/invitations`, {})).json()
      .code as string;

    const cohost = await registerUser(app);
    await api(cohost.token, 'POST', '/join', { code });
    await api(owner.token, 'PATCH', `/groups/${groupId}/members/${cohost.userId}`, {
      role: 'COHOST',
    });

    const member = await registerUser(app);
    await api(member.token, 'POST', '/join', { code });

    return { owner, cohost, member, groupId, code };
  };

  const punish = (token: string, groupId: string, targetId: string, reason?: string) =>
    api(
      token,
      'POST',
      `/groups/${groupId}/members/${targetId}/punish`,
      reason === undefined ? {} : { reason },
    );

  const pardon = (token: string, groupId: string, targetId: string) =>
    api(token, 'POST', `/groups/${groupId}/members/${targetId}/forgive`);

  describe('escalation', () => {
    it('climbs 0 → 1 → 2 → 3 and blocks at the third', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();

      const first = await punish(owner.token, groupId, member.userId);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ consecutivePunishments: 1, status: 'ACTIVE' });

      expect((await punish(owner.token, groupId, member.userId)).json()).toMatchObject({
        consecutivePunishments: 2,
        status: 'ACTIVE',
      });

      const third = await punish(owner.token, groupId, member.userId);
      // Three consecutive punishments bars them from games — but not from the group (D7).
      expect(third.json()).toMatchObject({ consecutivePunishments: 3, status: 'GAME_BLOCKED' });
    });

    it('refuses a fourth punishment', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();

      for (let index = 0; index < 3; index += 1) await punish(owner.token, groupId, member.userId);

      const response = await punish(owner.token, groupId, member.userId);

      expect(response.statusCode).toBe(409);
      expect(await prisma.punishmentEvent.count()).toBe(3);
    });

    it('leaves a blocked member with full access to the group', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();
      for (let index = 0; index < 3; index += 1) await punish(owner.token, groupId, member.userId);

      // Blocked from games, not from the group: they can still read it and see the roster.
      expect((await api(member.token, 'GET', `/groups/${groupId}`)).statusCode).toBe(200);
      expect((await api(member.token, 'GET', `/groups/${groupId}/members`)).statusCode).toBe(200);
    });

    it('excludes a blocked member from the eligible roster', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();
      for (let index = 0; index < 3; index += 1) await punish(owner.token, groupId, member.userId);

      const eligible = await prisma.groupMembership.findMany({
        where: { groupId, status: 'ACTIVE' },
      });

      expect(eligible).toHaveLength(2);
      expect(eligible.map((row) => row.userId)).not.toContain(member.userId);
    });
  });

  describe('the audit trail', () => {
    it('writes a record in the same transaction as the counter move', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();

      await punish(owner.token, groupId, member.userId, 'Missed the last two games');

      const event = await prisma.punishmentEvent.findFirstOrThrow();

      expect(event).toMatchObject({
        groupId,
        targetUserId: member.userId,
        actorUserId: owner.userId,
        action: 'PUNISH',
        resultingLevel: 1,
        reason: 'Missed the last two games',
      });
    });

    it('records the resulting level, so the counter is reconstructible from the log', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();

      await punish(owner.token, groupId, member.userId);
      await punish(owner.token, groupId, member.userId);
      await pardon(owner.token, groupId, member.userId);

      const events = await prisma.punishmentEvent.findMany({ orderBy: { createdAt: 'asc' } });

      expect(events.map((event) => [event.action, event.resultingLevel])).toEqual([
        ['PUNISH', 1],
        ['PUNISH', 2],
        ['FORGIVE', 0],
      ]);
    });

    it('writes nothing when the counter did not move', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();

      // Forgiving someone with nothing to forgive succeeds quietly; a no-op is not an event.
      const response = await pardon(owner.token, groupId, member.userId);

      expect(response.statusCode).toBe(200);
      expect(response.json().consecutivePunishments).toBe(0);
      expect(await prisma.punishmentEvent.count()).toBe(0);
    });

    it('shows the history to every member, hosts included', async () => {
      const { owner, member, cohost, groupId } = await makeGroupWithRoles();
      await punish(owner.token, groupId, member.userId, 'Late again');

      for (const token of [owner.token, cohost.token, member.token]) {
        const response = await api(token, 'GET', `/groups/${groupId}/punishments`);

        // Accountability for hosts, not a private list kept about people.
        expect(response.statusCode).toBe(200);
        expect(response.json().events[0]).toMatchObject({
          action: 'PUNISH',
          targetUserId: member.userId,
          resultingLevel: 1,
          reason: 'Late again',
        });
      }
    });

    it('hides the history from outsiders', async () => {
      const { groupId } = await makeGroupWithRoles();
      const outsider = await registerUser(app);

      expect((await api(outsider.token, 'GET', `/groups/${groupId}/punishments`)).statusCode).toBe(
        404,
      );
    });
  });

  describe('forgiveness', () => {
    it('clears the counter entirely rather than stepping down', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();
      await punish(owner.token, groupId, member.userId);
      await punish(owner.token, groupId, member.userId);

      const response = await pardon(owner.token, groupId, member.userId);

      // A host who forgives is ending the sentence, not reducing it.
      expect(response.json()).toMatchObject({ consecutivePunishments: 0, status: 'ACTIVE' });
    });

    it('restores a blocked member to eligibility', async () => {
      const { owner, member, groupId } = await makeGroupWithRoles();
      for (let index = 0; index < 3; index += 1) await punish(owner.token, groupId, member.userId);

      const response = await pardon(owner.token, groupId, member.userId);

      expect(response.json()).toMatchObject({ consecutivePunishments: 0, status: 'ACTIVE' });
    });
  });

  describe('who may punish whom', () => {
    it('lets a co-host punish an ordinary member', async () => {
      const { cohost, member, groupId } = await makeGroupWithRoles();

      expect((await punish(cohost.token, groupId, member.userId)).statusCode).toBe(200);
    });

    it('stops a co-host punishing the owner', async () => {
      const { cohost, owner, groupId } = await makeGroupWithRoles();

      expect((await punish(cohost.token, groupId, owner.userId)).statusCode).toBe(403);
    });

    it('stops a co-host punishing another co-host', async () => {
      const { owner, cohost, member, groupId } = await makeGroupWithRoles();
      await api(owner.token, 'PATCH', `/groups/${groupId}/members/${member.userId}`, {
        role: 'COHOST',
      });

      expect((await punish(cohost.token, groupId, member.userId)).statusCode).toBe(403);
    });

    it('stops an ordinary member punishing anyone', async () => {
      const { member, cohost, groupId } = await makeGroupWithRoles();

      expect((await punish(member.token, groupId, cohost.userId)).statusCode).toBe(403);
    });

    it('stops anyone punishing themselves', async () => {
      const { owner, groupId } = await makeGroupWithRoles();

      const response = await punish(owner.token, groupId, owner.userId);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('CANNOT_ACT_ON_SELF');
    });

    it('applies the same rules to forgiveness', async () => {
      const { owner, cohost, groupId } = await makeGroupWithRoles();
      await punish(owner.token, groupId, cohost.userId);

      // A co-host cannot undo a punishment the owner gave to a peer, either.
      expect((await pardon(cohost.token, groupId, cohost.userId)).statusCode).toBe(403);
    });

    it('returns 404 for someone outside the group', async () => {
      const { owner, groupId } = await makeGroupWithRoles();
      const outsider = await registerUser(app);

      expect((await punish(owner.token, groupId, outsider.userId)).statusCode).toBe(404);
    });
  });

  describe('counters are group-local', () => {
    it('keeps the same person’s levels independent across two groups', async () => {
      // The exit criterion for this phase, and the whole reason the counter lives on the
      // membership rather than on the user.
      const groupA = await makeGroupWithRoles();
      const groupB = await makeGroupWithRoles();

      const wanderer = await registerUser(app);
      await api(wanderer.token, 'POST', '/join', { code: groupA.code });
      await api(wanderer.token, 'POST', '/join', { code: groupB.code });

      await punish(groupA.owner.token, groupA.groupId, wanderer.userId);
      await punish(groupA.owner.token, groupA.groupId, wanderer.userId);

      const inA = await prisma.groupMembership.findUniqueOrThrow({
        where: { groupId_userId: { groupId: groupA.groupId, userId: wanderer.userId } },
      });
      const inB = await prisma.groupMembership.findUniqueOrThrow({
        where: { groupId_userId: { groupId: groupB.groupId, userId: wanderer.userId } },
      });

      expect(inA.consecutivePunishments).toBe(2);
      expect(inB.consecutivePunishments).toBe(0);
      expect(inB.status).toBe('ACTIVE');
    });

    it('keeps each group’s history to itself', async () => {
      const groupA = await makeGroupWithRoles();
      const groupB = await makeGroupWithRoles();

      await punish(groupA.owner.token, groupA.groupId, groupA.member.userId);

      const historyB = await api(
        groupB.owner.token,
        'GET',
        `/groups/${groupB.groupId}/punishments`,
      );

      expect(historyB.json().events).toEqual([]);
    });
  });

  describe('concurrency', () => {
    it('counts two simultaneous punishments as at most one step', async () => {
      const { owner, cohost, member, groupId } = await makeGroupWithRoles();

      const [first, second] = await Promise.all([
        punish(owner.token, groupId, member.userId),
        punish(cohost.token, groupId, member.userId),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();
      const membership = await prisma.groupMembership.findUniqueOrThrow({
        where: { groupId_userId: { groupId, userId: member.userId } },
      });

      // Without the compare-and-set both would read level 0, both write 1, and one punishment
      // would vanish. Either both succeed sequentially (level 2) or one is told to retry.
      if (statuses[1] === 409) {
        expect(membership.consecutivePunishments).toBe(1);
        expect(await prisma.punishmentEvent.count()).toBe(1);
      } else {
        expect(membership.consecutivePunishments).toBe(2);
        expect(await prisma.punishmentEvent.count()).toBe(2);
      }
    });
  });
});
