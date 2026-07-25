import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  GroupRole,
  MembershipStatus,
  SessionStatus,
  ContentStatus,
  type PrismaClient,
} from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { makeAnswerableSession, makeGroup, makeUser, makeTheme } from '../helpers/factories.js';

/**
 * Every constraint the schema declares, proven to actually reject bad data.
 *
 * These are not paranoia. Partial unique indexes, CHECK constraints and the uuid_generate_v7()
 * default are hand-written SQL that Prisma's schema language cannot express — which means
 * `prisma migrate dev` cannot see them, and a future generated migration could drop one without
 * a word. This suite is the alarm for that (docs/03-database-schema.md).
 */
describe('schema constraints', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  /**
   * The alarm for the Prisma limitation described at the top of the migration.
   *
   * `prisma migrate dev` diffs schema.prisma against the migration history. It cannot see
   * extensions, functions, filtered indexes or CHECK constraints, so a generated migration will
   * happily drop them. If this block goes red after someone runs `migrate dev`, the generated
   * migration needs its DROP statements removed before it is committed.
   */
  describe('hand-written DDL is present', () => {
    it.each([['pgcrypto'], ['citext']])('has the %s extension', async (name) => {
      const rows = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_extension WHERE extname = ${name}`;

      expect(Number(rows[0]?.count)).toBe(1);
    });

    it('has the uuid_generate_v7 function', async () => {
      const rows = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_proc WHERE proname = 'uuid_generate_v7'`;

      expect(Number(rows[0]?.count)).toBe(1);
    });

    it.each([['group_memberships_one_owner_per_group'], ['game_sessions_one_live_per_group']])(
      'has the partial unique index %s',
      async (indexName) => {
        const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${indexName}
      `;

        expect(rows).toHaveLength(1);
        // Without the WHERE clause it would be a plain unique index, which forbids far too much.
        expect(rows[0]?.indexdef).toMatch(/WHERE/i);
      },
    );

    it.each([
      ['group_memberships_punishment_range'],
      ['group_memberships_blocked_iff_max_punishments'],
      ['punishment_events_level_range'],
      ['game_players_punishment_level_range'],
      ['game_players_receive_quota_positive'],
      ['game_texts_body_not_blank'],
      ['answers_body_not_blank'],
      ['comments_body_not_blank'],
      ['invitations_max_uses_positive'],
      ['invitations_use_count_non_negative'],
      ['game_sessions_required_text_count_non_negative'],
    ])('has the CHECK constraint %s', async (constraintName) => {
      const rows = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_constraint
        WHERE contype = 'c' AND conname = ${constraintName}
      `;

      expect(Number(rows[0]?.count)).toBe(1);
    });
  });

  describe('identifiers', () => {
    it('generates version 7, time-ordered UUIDs', async () => {
      const first = await makeUser(prisma);
      const second = await makeUser(prisma);

      // Version nibble is the 15th hex digit: xxxxxxxx-xxxx-7xxx-…
      expect(first.id[14]).toBe('7');
      // Variant is 8, 9, a or b.
      expect(['8', '9', 'a', 'b']).toContain(second.id[19]);

      // Time-ordered, which is the entire reason for choosing v7 over v4.
      expect(first.id < second.id).toBe(true);
    });
  });

  describe('case-insensitive identity', () => {
    it('treats emails differing only in case as the same account', async () => {
      await makeUser(prisma, { email: 'Sarah@Example.com' });

      await expect(makeUser(prisma, { email: 'sarah@example.com' })).rejects.toThrow(
        /Unique constraint/i,
      );
    });

    it('treats usernames differing only in case as taken', async () => {
      await makeUser(prisma, { username: 'Sarah' });

      await expect(makeUser(prisma, { username: 'sarah' })).rejects.toThrow(/Unique constraint/i);
    });
  });

  describe('group_memberships', () => {
    it('allows exactly one owner per group', async () => {
      const owner = await makeUser(prisma);
      const usurper = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);

      await expect(
        prisma.groupMembership.create({
          data: { groupId: group.id, userId: usurper.id, role: GroupRole.OWNER },
        }),
      ).rejects.toThrow(/unique/i);
    });

    it('permits many co-hosts and members in the same group', async () => {
      const owner = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);

      for (const role of [GroupRole.COHOST, GroupRole.COHOST, GroupRole.MEMBER]) {
        const user = await makeUser(prisma);
        await prisma.groupMembership.create({ data: { groupId: group.id, userId: user.id, role } });
      }

      expect(await prisma.groupMembership.count({ where: { groupId: group.id } })).toBe(4);
    });

    it('allows the same user in two groups independently', async () => {
      const user = await makeUser(prisma);
      const groupA = await makeGroup(prisma, (await makeUser(prisma)).id);
      const groupB = await makeGroup(prisma, (await makeUser(prisma)).id);

      await prisma.groupMembership.create({ data: { groupId: groupA.id, userId: user.id } });
      await prisma.groupMembership.create({ data: { groupId: groupB.id, userId: user.id } });

      // The punishment counter is keyed by (group, user), so Group A cannot see Group B's.
      await prisma.groupMembership.update({
        where: { groupId_userId: { groupId: groupA.id, userId: user.id } },
        data: { consecutivePunishments: 2 },
      });

      const inB = await prisma.groupMembership.findUniqueOrThrow({
        where: { groupId_userId: { groupId: groupB.id, userId: user.id } },
      });
      expect(inB.consecutivePunishments).toBe(0);
    });

    it('rejects the same user joining one group twice', async () => {
      const owner = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);

      await expect(
        prisma.groupMembership.create({ data: { groupId: group.id, userId: owner.id } }),
      ).rejects.toThrow(/unique/i);
    });

    it('rejects a punishment counter above 3', async () => {
      const owner = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);

      await expect(
        prisma.groupMembership.update({
          where: { groupId_userId: { groupId: group.id, userId: owner.id } },
          data: { consecutivePunishments: 4, status: MembershipStatus.GAME_BLOCKED },
        }),
      ).rejects.toThrow(/constraint/i);
    });

    it('rejects a negative punishment counter', async () => {
      const owner = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);

      await expect(
        prisma.groupMembership.update({
          where: { groupId_userId: { groupId: group.id, userId: owner.id } },
          data: { consecutivePunishments: -1 },
        }),
      ).rejects.toThrow(/constraint/i);
    });

    it('refuses to let level 3 and GAME_BLOCKED disagree', async () => {
      const owner = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);
      const where = { groupId_userId: { groupId: group.id, userId: owner.id } };

      // Level 3 while still ACTIVE — a blocked player who could somehow still join.
      await expect(
        prisma.groupMembership.update({ where, data: { consecutivePunishments: 3 } }),
      ).rejects.toThrow(/constraint/i);

      // Blocked at level 1 — punished harder than the counter admits.
      await expect(
        prisma.groupMembership.update({
          where,
          data: { consecutivePunishments: 1, status: MembershipStatus.GAME_BLOCKED },
        }),
      ).rejects.toThrow(/constraint/i);

      // The consistent pair is accepted.
      const blocked = await prisma.groupMembership.update({
        where,
        data: { consecutivePunishments: 3, status: MembershipStatus.GAME_BLOCKED },
      });
      expect(blocked.status).toBe(MembershipStatus.GAME_BLOCKED);
    });
  });

  describe('game_sessions', () => {
    it('allows only one live session per group', async () => {
      const owner = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);
      const theme = await makeTheme(prisma);

      await prisma.gameSession.create({ data: { groupId: group.id, themeId: theme.id } });

      await expect(
        prisma.gameSession.create({ data: { groupId: group.id, themeId: theme.id } }),
      ).rejects.toThrow(/unique/i);
    });

    it.each([SessionStatus.COMPLETED, SessionStatus.CANCELLED, SessionStatus.ABANDONED])(
      'allows a new game once the previous one is %s',
      async (terminal) => {
        const owner = await makeUser(prisma);
        const group = await makeGroup(prisma, owner.id);
        const theme = await makeTheme(prisma);

        const first = await prisma.gameSession.create({
          data: { groupId: group.id, themeId: theme.id },
        });
        await prisma.gameSession.update({ where: { id: first.id }, data: { status: terminal } });

        const second = await prisma.gameSession.create({
          data: { groupId: group.id, themeId: theme.id },
        });
        expect(second.id).not.toBe(first.id);
      },
    );

    it('keeps any number of finished sessions', async () => {
      const owner = await makeUser(prisma);
      const group = await makeGroup(prisma, owner.id);
      const theme = await makeTheme(prisma);

      for (let index = 0; index < 3; index += 1) {
        const session = await prisma.gameSession.create({
          data: { groupId: group.id, themeId: theme.id },
        });
        await prisma.gameSession.update({
          where: { id: session.id },
          data: { status: SessionStatus.COMPLETED },
        });
      }

      expect(await prisma.gameSession.count({ where: { groupId: group.id } })).toBe(3);
    });

    it('allows two different groups to run games at the same time', async () => {
      const theme = await makeTheme(prisma);
      const groupA = await makeGroup(prisma, (await makeUser(prisma)).id);
      const groupB = await makeGroup(prisma, (await makeUser(prisma)).id);

      await prisma.gameSession.create({ data: { groupId: groupA.id, themeId: theme.id } });
      await prisma.gameSession.create({ data: { groupId: groupB.id, themeId: theme.id } });

      expect(await prisma.gameSession.count()).toBe(2);
    });
  });

  describe('text_assignments', () => {
    it('never assigns the same text to one receiver twice', async () => {
      // Equivalently: never two texts by the same author to one receiver (D2), since each
      // author writes exactly one text.
      const { texts, players } = await makeAnswerableSession(prisma, 3);
      const text = texts[0]!;
      const receiver = players[1]!;

      await prisma.textAssignment.create({
        data: { sessionId: text.sessionId, textId: text.id, receiverPlayerId: receiver.id },
      });

      await expect(
        prisma.textAssignment.create({
          data: { sessionId: text.sessionId, textId: text.id, receiverPlayerId: receiver.id },
        }),
      ).rejects.toThrow(/unique/i);
    });

    it('allows one text to reach several receivers', async () => {
      // This is what makes punishment loads arithmetically possible (D1): with 3 players and one
      // punished, there are more answer slots than texts.
      const { texts, players } = await makeAnswerableSession(prisma, 3);
      const text = texts[0]!;

      for (const player of players) {
        await prisma.textAssignment.create({
          data: { sessionId: text.sessionId, textId: text.id, receiverPlayerId: player.id },
        });
      }

      expect(await prisma.textAssignment.count({ where: { textId: text.id } })).toBe(3);
    });

    it('allows a player to receive their own text', async () => {
      // Explicitly permitted by the brief, and unavoidable at N = 2 (D4).
      const { texts, players } = await makeAnswerableSession(prisma, 2);
      const text = texts[0]!;

      const assignment = await prisma.textAssignment.create({
        data: {
          sessionId: text.sessionId,
          textId: text.id,
          receiverPlayerId: text.authorPlayerId,
        },
      });

      expect(assignment.receiverPlayerId).toBe(players[0]!.id);
    });
  });

  describe('game_texts', () => {
    it('allows only one text per author', async () => {
      const { players, session } = await makeAnswerableSession(prisma, 2);
      const author = players[0]!;

      await expect(
        prisma.gameText.create({
          data: { sessionId: session.id, authorPlayerId: author.id, body: 'a second text' },
        }),
      ).rejects.toThrow(/unique/i);
    });

    it.each([
      ['an empty body', ''],
      ['whitespace only', '   \n\t  '],
    ])('rejects %s', async (_label, body) => {
      const { players, session } = await makeAnswerableSession(prisma, 2, { withTexts: false });

      await expect(
        prisma.gameText.create({
          data: { sessionId: session.id, authorPlayerId: players[0]!.id, body },
        }),
      ).rejects.toThrow(/constraint/i);
    });
  });

  describe('answers and comments', () => {
    it('rejects a blank answer', async () => {
      const { texts, players, session } = await makeAnswerableSession(prisma, 2);
      const assignment = await prisma.textAssignment.create({
        data: { sessionId: session.id, textId: texts[0]!.id, receiverPlayerId: players[1]!.id },
      });

      await expect(
        prisma.answer.create({
          data: { assignmentId: assignment.id, sessionId: session.id, body: '  ' },
        }),
      ).rejects.toThrow(/constraint/i);
    });

    it('allows at most one answer per assignment', async () => {
      const { texts, players, session } = await makeAnswerableSession(prisma, 2);
      const assignment = await prisma.textAssignment.create({
        data: { sessionId: session.id, textId: texts[0]!.id, receiverPlayerId: players[1]!.id },
      });

      await prisma.answer.create({
        data: {
          assignmentId: assignment.id,
          sessionId: session.id,
          body: 'my answer',
          status: ContentStatus.SUBMITTED,
        },
      });

      await expect(
        prisma.answer.create({
          data: { assignmentId: assignment.id, sessionId: session.id, body: 'again' },
        }),
      ).rejects.toThrow(/unique/i);
    });
  });

  describe('reveal_votes', () => {
    it('allows only one vote per player', async () => {
      const { players, session } = await makeAnswerableSession(prisma, 2);

      await prisma.revealVote.create({
        data: { sessionId: session.id, playerId: players[0]!.id, choice: 'YES' },
      });

      await expect(
        prisma.revealVote.create({
          data: { sessionId: session.id, playerId: players[0]!.id, choice: 'NO' },
        }),
      ).rejects.toThrow(/unique/i);
    });
  });

  describe('author_guesses', () => {
    it('allows only one guess per player per text', async () => {
      const { texts, players, session } = await makeAnswerableSession(prisma, 3);

      await prisma.authorGuess.create({
        data: {
          sessionId: session.id,
          textId: texts[0]!.id,
          guesserPlayerId: players[1]!.id,
          guessedPlayerId: players[2]!.id,
        },
      });

      await expect(
        prisma.authorGuess.create({
          data: {
            sessionId: session.id,
            textId: texts[0]!.id,
            guesserPlayerId: players[1]!.id,
            guessedPlayerId: players[0]!.id,
          },
        }),
      ).rejects.toThrow(/unique/i);
    });
  });

  describe('invitations', () => {
    it('rejects a non-positive use cap', async () => {
      const group = await makeGroup(prisma, (await makeUser(prisma)).id);

      await expect(
        prisma.invitation.create({ data: { groupId: group.id, code: 'ABCD2345', maxUses: 0 } }),
      ).rejects.toThrow(/constraint/i);
    });

    it('rejects a duplicate code across groups', async () => {
      const groupA = await makeGroup(prisma, (await makeUser(prisma)).id);
      const groupB = await makeGroup(prisma, (await makeUser(prisma)).id);

      await prisma.invitation.create({ data: { groupId: groupA.id, code: 'JKMN4567' } });

      await expect(
        prisma.invitation.create({ data: { groupId: groupB.id, code: 'JKMN4567' } }),
      ).rejects.toThrow(/unique/i);
    });
  });

  describe('game_players', () => {
    it('rejects a snapshot punishment level of 3, which can never reach a roster', async () => {
      const { players } = await makeAnswerableSession(prisma, 2);

      await expect(
        prisma.gamePlayer.update({
          where: { id: players[0]!.id },
          data: { punishmentLevelAtStart: 3 },
        }),
      ).rejects.toThrow(/constraint/i);
    });

    it('rejects a receive quota below one — everyone answers at least one text', async () => {
      const { players } = await makeAnswerableSession(prisma, 2);

      await expect(
        prisma.gamePlayer.update({ where: { id: players[0]!.id }, data: { receiveQuota: 0 } }),
      ).rejects.toThrow(/constraint/i);
    });
  });
});
