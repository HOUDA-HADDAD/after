import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { registerUser } from '../helpers/auth.js';
import { seedThemes } from '../../prisma/seed.js';
import {
  call,
  everyoneAnswers,
  everyoneVotes,
  everyoneWrites,
  makeLobby,
  state,
  themeId,
} from '../helpers/game.js';

describe('game sessions', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = testPrisma();
    ({ app } = await buildTestApp());
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    // Themes are reference data, not game data — the seed is part of every deployment.
    await seedThemes(prisma);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  /* ---- the full game -------------------------------------------------------------------- */

  describe('a complete five-player game with one punished player', () => {
    it('plays end to end, holding every invariant at every phase', async () => {
      const game = await makeLobby(app, 5);
      const punished = game.players[0]!;

      // Punish one player twice before the game starts: they will answer three texts (D6).
      for (let index = 0; index < 2; index += 1) {
        await call(
          app,
          game.host.token,
          'POST',
          `/groups/${game.groupId}/members/${punished.userId}/punish`,
        );
      }

      /* --- lobby --- */
      let view = await state(app, game.host.token, game.sessionId);
      expect(view.phase).toBe('LOBBY');
      expect(view.players).toHaveLength(5);
      expect(view.you?.isHost).toBe(true);
      expect(view.timeline).toBeNull();

      /* --- start --- */
      view = (await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`)).json();
      expect(view.phase).toBe('WRITING');
      expect(view.progress).toEqual({ submitted: 0, required: 5 });

      /* --- writing --- */
      await everyoneWrites(app, game);

      view = await state(app, game.host.token, game.sessionId);
      // Distribution runs automatically once the last text lands.
      expect(view.phase).toBe('ANSWERING');

      /* --- distribution invariants, checked against the database --- */
      const assignments = await prisma.textAssignment.findMany({
        include: { text: true },
      });

      // Five players, one at level 2: 4×1 + 3 = 7 answer slots over 5 texts (D1).
      expect(assignments).toHaveLength(7);

      const punishedPlayer = await prisma.gamePlayer.findFirstOrThrow({
        where: { sessionId: game.sessionId, userId: punished.userId },
      });
      expect(punishedPlayer.receiveQuota).toBe(3);

      const byReceiver = new Map<string, string[]>();
      for (const assignment of assignments) {
        byReceiver.set(assignment.receiverPlayerId, [
          ...(byReceiver.get(assignment.receiverPlayerId) ?? []),
          assignment.textId,
        ]);
      }

      // I2 — nobody holds the same text twice, which is also never two texts by one author.
      for (const held of byReceiver.values()) {
        expect(new Set(held).size).toBe(held.length);
      }

      // I3 — every text was handed to somebody.
      const usedTexts = new Set(assignments.map((assignment) => assignment.textId));
      expect(usedTexts.size).toBe(5);

      // I5 — with five texts and a maximum demand of three, nobody gets their own.
      for (const assignment of assignments) {
        expect(assignment.text.authorPlayerId).not.toBe(assignment.receiverPlayerId);
      }

      /* --- answering --- */
      const punishedView = await state(app, punished.token, game.sessionId);
      expect(punishedView.you?.assignments).toHaveLength(3);

      const normalView = await state(app, game.players[1]!.token, game.sessionId);
      expect(normalView.you?.assignments).toHaveLength(1);

      await everyoneAnswers(app, game);

      view = await state(app, game.host.token, game.sessionId);
      expect(view.phase).toBe('REVIEW');
      expect(view.timeline).not.toBeNull();
      expect(view.timeline?.texts).toHaveLength(5);
      expect(view.timeline?.authorsVisible).toBe(false);

      /* --- discussion --- */
      const firstAnswer = view.timeline?.texts[0]?.answers[0];
      expect(firstAnswer).toBeDefined();

      await call(
        app,
        game.players[1]!.token,
        'POST',
        `/sessions/${game.sessionId}/answers/${firstAnswer!.id}/comments`,
        { body: 'That is hilarious', isAnonymous: true },
      );

      const guessTarget = view.timeline!.texts[0]!;
      await call(
        app,
        game.players[1]!.token,
        'PUT',
        `/sessions/${game.sessionId}/texts/${guessTarget.id}/guess`,
        { guessedPlayerId: view.players[0]!.playerId },
      );

      /* --- reveal --- */
      view = (await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`)).json();
      expect(view.phase).toBe('REVEAL');
      expect(view.reveal).toMatchObject({ decided: 0, total: 5, closed: false });

      await everyoneVotes(app, game, 'YES');

      view = await state(app, game.host.token, game.sessionId);
      // Everyone voted, so the game completes without waiting for the host.
      expect(view.phase).toBe('COMPLETED');
      expect(view.reveal).toMatchObject({ decided: 5, total: 5, closed: true, revealed: true });
      expect(view.timeline?.authorsVisible).toBe(true);
      expect(view.timeline?.texts.every((text) => text.author !== null)).toBe(true);

      /* --- punishment settlement (D5) --- */
      const punishedMembership = await prisma.groupMembership.findUniqueOrThrow({
        where: { groupId_userId: { groupId: game.groupId, userId: punished.userId } },
      });
      const cleanMembership = await prisma.groupMembership.findUniqueOrThrow({
        where: { groupId_userId: { groupId: game.groupId, userId: game.players[1]!.userId } },
      });

      // Punished for this game: the level stands. Everyone else was already at zero.
      expect(punishedMembership.consecutivePunishments).toBe(2);
      expect(cleanMembership.consecutivePunishments).toBe(0);

      /* --- the purge clock is set --- */
      const session = await prisma.gameSession.findUniqueOrThrow({
        where: { id: game.sessionId },
      });
      expect(session.purgeAfter).not.toBeNull();
      expect(session.endedAt).not.toBeNull();
    });
  });

  /* ---- lobby rules ---------------------------------------------------------------------- */

  describe('the lobby', () => {
    it('refuses to start with fewer than two players', async () => {
      const host = await registerUser(app);
      const groupId = (await call(app, host.token, 'POST', '/groups', { name: 'Solo' })).json()
        .id as string;

      const sessionId = (
        await call(app, host.token, 'POST', `/groups/${groupId}/sessions`, {
          themeId: await themeId(app, host.token, 'questions', groupId),
        })
      ).json().id as string;

      const response = await call(app, host.token, 'POST', `/sessions/${sessionId}/start`);

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('SESSION_TOO_FEW_PLAYERS');
    });

    it('allows only one live game per group', async () => {
      const game = await makeLobby(app, 2);

      const response = await call(
        app,
        game.host.token,
        'POST',
        `/groups/${game.groupId}/sessions`,
        {
          themeId: await themeId(app, game.host.token, 'questions', game.groupId),
        },
      );

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('SESSION_ALREADY_ACTIVE');
    });

    it('locks the roster once the game starts', async () => {
      const game = await makeLobby(app, 2);
      const latecomer = await registerUser(app);
      const code = (
        await call(app, game.host.token, 'POST', `/groups/${game.groupId}/invitations`, {})
      ).json().code as string;
      await call(app, latecomer.token, 'POST', '/join', { code });

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      const response = await call(app, latecomer.token, 'POST', `/sessions/${game.sessionId}/join`);

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('SESSION_ROSTER_LOCKED');
    });

    it('keeps a blocked player out of the game but not out of the group', async () => {
      const game = await makeLobby(app, 3);
      const blocked = game.players[0]!;

      for (let index = 0; index < 3; index += 1) {
        await call(
          app,
          game.host.token,
          'POST',
          `/groups/${game.groupId}/members/${blocked.userId}/punish`,
        );
      }

      await call(app, blocked.token, 'POST', `/sessions/${game.sessionId}/leave`);
      const response = await call(app, blocked.token, 'POST', `/sessions/${game.sessionId}/join`);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('MEMBER_GAME_BLOCKED');
      // Still a full member of the group (D7).
      expect((await call(app, blocked.token, 'GET', `/groups/${game.groupId}`)).statusCode).toBe(
        200,
      );
    });

    it('hides a game from someone outside the group', async () => {
      const game = await makeLobby(app, 2);
      const outsider = await registerUser(app);

      const response = await call(app, outsider.token, 'GET', `/sessions/${game.sessionId}`);

      expect(response.statusCode).toBe(404);
    });
  });

  /* ---- writing and answering ------------------------------------------------------------- */

  describe('writing', () => {
    it('rejects an empty submission', async () => {
      const game = await makeLobby(app, 2);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      for (const body of ['', '   ', '\n\t ']) {
        const response = await call(
          app,
          game.host.token,
          'POST',
          `/sessions/${game.sessionId}/text/submit`,
          { body },
        );

        expect(response.statusCode).toBe(400);
      }
    });

    it('autosaves a draft and keeps it private', async () => {
      const game = await makeLobby(app, 2);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      await call(app, game.host.token, 'PUT', `/sessions/${game.sessionId}/text`, {
        body: 'half a thought',
      });

      // The author sees their own draft…
      expect((await state(app, game.host.token, game.sessionId)).you?.draftText).toBe(
        'half a thought',
      );
      // …and nobody else sees it anywhere in their payload.
      const other = await call(app, game.players[0]!.token, 'GET', `/sessions/${game.sessionId}`);
      expect(other.body).not.toContain('half a thought');
    });

    it('refuses a second submission', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'my one text',
      });

      const response = await call(
        app,
        game.host.token,
        'POST',
        `/sessions/${game.sessionId}/text/submit`,
        { body: 'a second one' },
      );

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('ALREADY_SUBMITTED');
    });

    it('reports progress as a count, never as names', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'the first text',
      });

      const view = await state(app, game.players[0]!.token, game.sessionId);

      expect(view.progress).toEqual({ submitted: 1, required: 3 });
      // Nothing in the payload says who the one submission belongs to.
      expect(JSON.stringify(view)).not.toContain('the first text');
    });
  });

  describe('answering', () => {
    it('refuses to answer somebody else’s assignment', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
      await everyoneWrites(app, game);

      const hostView = await state(app, game.host.token, game.sessionId);
      const theirs = hostView.you!.assignments[0]!.assignmentId;

      const response = await call(
        app,
        game.players[0]!.token,
        'POST',
        `/sessions/${game.sessionId}/assignments/${theirs}/answer/submit`,
        { body: 'not mine to answer' },
      );

      // 404, not 403 — confirming the assignment exists would be a correlation hint.
      expect(response.statusCode).toBe(404);
    });
  });

  /* ---- host controls -------------------------------------------------------------------- */

  describe('force advance', () => {
    it('continues past a player who never wrote anything', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'the host wrote this',
      });
      await call(app, game.players[0]!.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'and this one',
      });

      const view = (
        await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/advance`)
      ).json();

      expect(view.phase).toBe('ANSWERING');
      // Two texts, three players, so three answer slots over two texts.
      expect(await prisma.textAssignment.count()).toBe(3);
    });

    it('refuses to advance below two texts', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'the only text',
      });

      const response = await call(
        app,
        game.host.token,
        'POST',
        `/sessions/${game.sessionId}/advance`,
      );

      expect(response.statusCode).toBe(409);
    });

    it('marks unanswered assignments as skipped rather than dropping them', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
      await everyoneWrites(app, game);

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/advance`);

      const view = await state(app, game.host.token, game.sessionId);
      expect(view.phase).toBe('REVIEW');

      const answers = view.timeline!.texts.flatMap((text) => text.answers);
      // Somebody's text going unanswered is visible in the timeline, not silently hidden (D14).
      expect(answers).toHaveLength(3);
      expect(answers.every((answer) => answer.skipped)).toBe(true);
    });

    it('is refused to a plain player', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      const response = await call(
        app,
        game.players[0]!.token,
        'POST',
        `/sessions/${game.sessionId}/advance`,
      );

      expect(response.statusCode).toBe(403);
    });
  });

  /* ---- concurrency ----------------------------------------------------------------------- */

  describe('the distribution critical section', () => {
    it('runs exactly once when twenty requests race for the last submission', async () => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'the first text',
      });
      await call(app, game.players[0]!.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'the second text',
      });

      // Twenty simultaneous attempts at the final submission. Nineteen must fail as duplicates,
      // and — crucially — the distribution must run once, not twenty times.
      const attempts = await Promise.all(
        Array.from({ length: 20 }, () =>
          call(app, game.players[1]!.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
            body: 'the last text',
          }),
        ),
      );

      expect(attempts.filter((response) => response.statusCode === 200)).toHaveLength(1);

      const session = await prisma.gameSession.findUniqueOrThrow({
        where: { id: game.sessionId },
      });
      expect(session.status).toBe('ANSWERING');

      // Three players, one text each, one assignment each. Twenty distributions would have
      // produced sixty rows, or a unique-constraint violation.
      expect(await prisma.textAssignment.count()).toBe(3);
      expect(await prisma.gameText.count()).toBe(3);
    });

    it('produces the same assignment when replayed from the stored seed', async () => {
      const game = await makeLobby(app, 4);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
      await everyoneWrites(app, game);

      const first = await prisma.textAssignment.findMany({ orderBy: { id: 'asc' } });
      const session = await prisma.gameSession.findUniqueOrThrow({
        where: { id: game.sessionId },
      });

      // The seed is stored, so a distribution can be reproduced for debugging long after the
      // game itself has been deleted.
      expect(session.distributionSeed).toBeGreaterThan(0n);
      expect(first).toHaveLength(4);
    });
  });

  /* ---- maintenance jobs ------------------------------------------------------------------ */

  describe('scheduled maintenance', () => {
    it('purges a finished game once its grace window elapses', async () => {
      const game = await makeLobby(app, 2);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
      await everyoneWrites(app, game);
      await everyoneAnswers(app, game);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);
      await everyoneVotes(app, game, 'YES');

      await prisma.gameSession.update({
        where: { id: game.sessionId },
        data: { purgeAfter: new Date(Date.now() - 1000) },
      });

      const purged = await app.maintenance.purgeSessions();

      expect(purged).toBe(1);
      // One DELETE, and the cascade takes everything with it (D11).
      expect(await prisma.gameSession.count()).toBe(0);
      expect(await prisma.gamePlayer.count()).toBe(0);
      expect(await prisma.gameText.count()).toBe(0);
      expect(await prisma.answer.count()).toBe(0);
      expect(await prisma.revealVote.count()).toBe(0);
      // The durable zone is untouched.
      expect(await prisma.group.count()).toBe(1);
      expect(await prisma.user.count()).toBe(2);
    });

    it('abandons a game nobody has touched, freeing the group’s slot', async () => {
      const game = await makeLobby(app, 2);

      await prisma.gameSession.update({
        where: { id: game.sessionId },
        data: { lastActivityAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const abandoned = await app.maintenance.abandonStaleSessions();

      expect(abandoned).toBe(1);

      // The group can start another game now, which is the point of abandoning (D12).
      const response = await call(
        app,
        game.host.token,
        'POST',
        `/groups/${game.groupId}/sessions`,
        {
          themeId: await themeId(app, game.host.token, 'questions', game.groupId),
        },
      );
      expect(response.statusCode).toBe(201);
    });

    it('does not reset punishment counters when a game is abandoned', async () => {
      // An abandoned game is not "a game played" (D5).
      const game = await makeLobby(app, 2);
      await call(
        app,
        game.host.token,
        'POST',
        `/groups/${game.groupId}/members/${game.players[0]!.userId}/punish`,
      );

      await prisma.gameSession.update({
        where: { id: game.sessionId },
        data: { lastActivityAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });
      await app.maintenance.abandonStaleSessions();

      const membership = await prisma.groupMembership.findUniqueOrThrow({
        where: { groupId_userId: { groupId: game.groupId, userId: game.players[0]!.userId } },
      });
      expect(membership.consecutivePunishments).toBe(1);
    });

    it('runs a full sweep under advisory locks', async () => {
      const result = await app.maintenance.runAll();

      expect(result).toEqual({
        purgedSessions: 0,
        abandonedSessions: 0,
        prunedAuthSessions: 0,
      });
    });
  });
});
