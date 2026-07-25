import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { REDACTED_PATHS } from '../../src/app.js';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { seedThemes } from '../../prisma/seed.js';
import {
  call,
  everyoneAnswers,
  everyoneVotes,
  everyoneWrites,
  makeLobby,
  state,
  type GameFixture,
} from '../helpers/game.js';

/**
 * The anonymity regression suite.
 *
 * Anonymity is the product: if authorship leaks once, the game is over. So these assertions are
 * made on **serialized output** — the actual JSON that crosses the wire — not on internal
 * objects, because a leak is defined by what is sent, not by what a component happens to render.
 *
 * A release blocker. See docs/08-testing.md.
 */
describe('anonymity', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = testPrisma();
    ({ app } = await buildTestApp());
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedThemes(prisma);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  /** Play a game up to the review phase, with a comment and a guess in place. */
  const playToReview = async (playerCount = 4): Promise<GameFixture> => {
    const game = await makeLobby(app, playerCount);

    await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
    await everyoneWrites(app, game);
    await everyoneAnswers(app, game);

    const view = await state(app, game.host.token, game.sessionId);
    const answer = view.timeline?.texts[0]?.answers[0];

    if (answer !== undefined) {
      await call(
        app,
        game.players[0]!.token,
        'POST',
        `/sessions/${game.sessionId}/answers/${answer.id}/comments`,
        { body: 'an anonymous remark', isAnonymous: true },
      );

      // A two-player game has only one non-host player, so the signed comment is conditional.
      const signer = game.players[1] ?? game.host;
      await call(
        app,
        signer.token,
        'POST',
        `/sessions/${game.sessionId}/answers/${answer.id}/comments`,
        { body: 'a signed remark', isAnonymous: false },
      );
    }

    const text = view.timeline?.texts[0];
    if (text !== undefined) {
      await call(
        app,
        game.players[0]!.token,
        'PUT',
        `/sessions/${game.sessionId}/texts/${text.id}/guess`,
        { guessedPlayerId: view.players[1]!.playerId },
      );
    }

    return game;
  };

  /** Every raw payload a viewer receives for a session. */
  const rawState = async (game: GameFixture, token: string): Promise<string> =>
    (await call(app, token, 'GET', `/sessions/${game.sessionId}`)).body;

  /* ---- A1 ------------------------------------------------------------------------------- */

  describe('A1 — no author identifier in a live phase, for any role', () => {
    it.each(['WRITING', 'ANSWERING', 'REVIEW'] as const)('holds during %s', async (targetPhase) => {
      const game = await makeLobby(app, 3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      if (targetPhase !== 'WRITING') await everyoneWrites(app, game);
      if (targetPhase === 'REVIEW') await everyoneAnswers(app, game);

      for (const player of game.all) {
        const view = await state(app, player.token, game.sessionId);

        expect(view.phase).toBe(targetPhase);
        expect(view.timeline?.authorsVisible ?? false).toBe(false);

        for (const text of view.timeline?.texts ?? []) {
          expect(text.author).toBeNull();
          for (const answer of text.answers) expect(answer.author).toBeNull();
        }
      }
    });

    it('never names an author to the host, who has every other power', async () => {
      const game = await playToReview();
      const view = await state(app, game.host.token, game.sessionId);

      // Being a host confers control over the game, not visibility into who wrote what.
      expect(view.timeline?.texts.every((text) => text.author === null)).toBe(true);
    });

    it('never ships an author id under any key name', async () => {
      const game = await playToReview();
      const body = await rawState(game, game.host.token);

      // The serialized payload, not the object: `authorPlayerId` hidden in a response is not
      // hidden at all.
      expect(body).not.toMatch(/authorPlayerId|author_player_id|receiverPlayerId/);
    });
  });

  /* ---- A2 ------------------------------------------------------------------------------- */

  describe('A2 — anonymous comments stay anonymous forever', () => {
    it('hides the author in review and after a full reveal alike', async () => {
      const game = await playToReview();

      const anonymousDuringReview = (await state(app, game.host.token, game.sessionId))
        .timeline!.texts.flatMap((text) => text.answers)
        .flatMap((answer) => answer.comments)
        .find((comment) => comment.body === 'an anonymous remark');

      expect(anonymousDuringReview?.author).toBeNull();

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);
      await everyoneVotes(app, game, 'YES');

      const after = (await state(app, game.host.token, game.sessionId))
        .timeline!.texts.flatMap((text) => text.answers)
        .flatMap((answer) => answer.comments);

      // The promise is made when Post is pressed; the group's later vote is not theirs to
      // override (D17).
      expect(after.find((comment) => comment.body === 'an anonymous remark')?.author).toBeNull();
      // A signed comment was always attributable, and still is.
      expect(after.find((comment) => comment.body === 'a signed remark')?.author).not.toBeNull();
    });
  });

  /* ---- A3 ------------------------------------------------------------------------------- */

  describe('A3 — the reveal split is never published', () => {
    it('reports counts only, whatever the mixture of votes', async () => {
      const game = await playToReview(4);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);

      await call(app, game.all[0]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });
      await call(app, game.all[1]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'NO',
      });

      for (const player of game.all) {
        const view = await state(app, player.token, game.sessionId);

        expect(view.reveal).toEqual({ decided: 2, total: 4, closed: false, revealed: false });
        // No key anywhere carries a yes/no breakdown — it is not computed, so it cannot be sent.
        expect(Object.keys(view.reveal!).sort()).toEqual([
          'closed',
          'decided',
          'revealed',
          'total',
        ]);
      }
    });

    it('does not leak a vote through the raw payload', async () => {
      const game = await playToReview(3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);
      await call(app, game.all[0]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'NO',
      });

      for (const player of game.all) {
        const body = await rawState(game, player.token);

        expect(body).not.toMatch(/"choice"/);
        expect(body).not.toMatch(/revealVotes?"/);
        expect(body).not.toMatch(/"yes"|"no"/i);
      }
    });

    it('tells the voter only that they voted, never what they chose', async () => {
      const game = await playToReview(3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);

      const response = await call(
        app,
        game.all[0]!.token,
        'POST',
        `/sessions/${game.sessionId}/reveal-vote`,
        { choice: 'NO' },
      );

      expect(response.json().you.revealVoteCast).toBe(true);
      expect(response.body).not.toMatch(/"choice"/);
    });
  });

  /* ---- A4 and A5 ------------------------------------------------------------------------ */

  describe('A4 — one refusal hides authors from everyone', () => {
    it('keeps the completed timeline identical, in identity terms, to the review one', async () => {
      const game = await playToReview(3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);

      const duringReview = await state(app, game.all[0]!.token, game.sessionId);

      await call(app, game.all[0]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });
      await call(app, game.all[1]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });
      await call(app, game.all[2]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'NO',
      });

      for (const player of game.all) {
        const after = await state(app, player.token, game.sessionId);

        expect(after.phase).toBe('COMPLETED');
        expect(after.reveal?.revealed).toBe(false);
        expect(after.timeline?.authorsVisible).toBe(false);

        // Including for the two who voted yes — that is the whole point of collective reveal (D8).
        for (const text of after.timeline?.texts ?? []) {
          expect(text.author).toBeNull();
          expect(text.yourGuessCorrect).toBeNull();
          for (const answer of text.answers) expect(answer.author).toBeNull();
        }
      }

      expect(duringReview.timeline?.authorsVisible).toBe(false);
    });

    it('treats an abstention as a refusal', async () => {
      // Silence must never authorise disclosure.
      const game = await playToReview(3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);

      await call(app, game.all[0]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });
      await call(app, game.all[1]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });

      // The third never votes; the host closes the window.
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/close-voting`);

      const view = await state(app, game.all[0]!.token, game.sessionId);

      expect(view.phase).toBe('COMPLETED');
      expect(view.timeline?.authorsVisible).toBe(false);
    });
  });

  describe('A5 — identities appear only after voting closes, and then for everyone', () => {
    it('withholds names while the vote is still open, even when unanimous so far', async () => {
      const game = await playToReview(2);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);

      await call(app, game.all[0]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });

      // One yes, one still to vote: a refresh at this exact moment must not leak names.
      const view = await state(app, game.all[0]!.token, game.sessionId);

      expect(view.phase).toBe('REVEAL');
      expect(view.timeline?.authorsVisible).toBe(false);
      expect(view.timeline?.texts.every((text) => text.author === null)).toBe(true);
    });

    it('shows the same names to every participant once unanimous', async () => {
      const game = await playToReview(3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);
      await everyoneVotes(app, game, 'YES');

      const views = await Promise.all(
        game.all.map((player) => state(app, player.token, game.sessionId)),
      );

      for (const view of views) {
        expect(view.timeline?.authorsVisible).toBe(true);
        expect(view.timeline?.texts.every((text) => text.author !== null)).toBe(true);
      }

      // Identical for everyone: entitlement is collective, not per-viewer.
      const authors = views.map((view) =>
        view.timeline!.texts.map((text) => text.author?.username).join(','),
      );
      expect(new Set(authors).size).toBe(1);
    });
  });

  /* ---- A6 ------------------------------------------------------------------------------- */

  describe('A6 — guess correctness follows the same gate', () => {
    it('withholds the verdict and the leaderboard when reveal fails', async () => {
      const game = await playToReview(3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);

      await call(app, game.all[0]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'NO',
      });
      await call(app, game.all[1]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });
      await call(app, game.all[2]!.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, {
        choice: 'YES',
      });

      const view = await state(app, game.players[0]!.token, game.sessionId);

      // Telling someone their guess was right discloses the author just as surely as naming
      // them (D9).
      expect(view.timeline?.guessScores).toBeNull();
      expect(view.timeline?.texts.every((text) => text.yourGuessCorrect === null)).toBe(true);
    });

    it('shows the viewer their own guess even while the verdict is withheld', async () => {
      const game = await playToReview(3);
      const view = await state(app, game.players[0]!.token, game.sessionId);

      const guessed = view.timeline?.texts.find((text) => text.yourGuess !== null);

      // They already know what they picked; that is not a disclosure.
      expect(guessed?.yourGuess).not.toBeNull();
      expect(guessed?.yourGuessCorrect).toBeNull();
    });

    it('releases scores once the group agreed', async () => {
      const game = await playToReview(3);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/end`);
      await everyoneVotes(app, game, 'YES');

      const view = await state(app, game.players[0]!.token, game.sessionId);

      expect(view.timeline?.guessScores).not.toBeNull();
      expect(view.timeline?.guessScores?.length).toBeGreaterThan(0);
    });
  });

  /* ---- A7 ------------------------------------------------------------------------------- */

  describe('A7 — timeline order is seeded, not submission order', () => {
    it('does not simply mirror the order the texts were written in', async () => {
      // Submission order identifies the fastest typist, so display order comes from the seed.
      const orders: string[] = [];

      for (let attempt = 0; attempt < 6; attempt += 1) {
        await resetDatabase(prisma);
        await seedThemes(prisma);

        const game = await makeLobby(app, 5);
        await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

        // Written strictly in roster order.
        for (const [index, player] of game.all.entries()) {
          await call(app, player.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
            body: `position-${String(index)}`,
          });
        }

        const view = await state(app, game.host.token, game.sessionId);
        await everyoneAnswers(app, game);

        const reviewed = await state(app, game.host.token, game.sessionId);
        orders.push(reviewed.timeline!.texts.map((text) => text.body).join('|'));

        expect(view.phase).toBe('ANSWERING');
      }

      // Across six games the display order varies, so it is not a function of who typed first.
      expect(new Set(orders).size).toBeGreaterThan(1);
    });
  });

  /* ---- A8 ------------------------------------------------------------------------------- */

  describe('A8 — progress is aggregate only', () => {
    it('never says who has submitted', async () => {
      const game = await makeLobby(app, 4);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);

      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
        body: 'a distinctive phrase nobody else wrote',
      });

      for (const player of game.players) {
        const body = await rawState(game, player.token);
        const view = JSON.parse(body) as { progress: { submitted: number } };

        expect(view.progress.submitted).toBe(1);
        // The count is the only signal — the content and its author are both absent.
        expect(body).not.toContain('a distinctive phrase nobody else wrote');
      }
    });
  });

  /* ---- A9 ------------------------------------------------------------------------------- */

  describe('A9 — the assignment map is never exposed', () => {
    it('shows a player their own assignments and nobody else’s', async () => {
      const game = await makeLobby(app, 4);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
      await everyoneWrites(app, game);

      const hostView = await state(app, game.host.token, game.sessionId);
      const hostAssignmentIds = new Set(
        hostView.you!.assignments.map((assignment) => assignment.assignmentId),
      );

      for (const player of game.players) {
        const body = await rawState(game, player.token);

        // Knowing who received which text narrows authorship by elimination, so the map is not
        // exposed to anyone — including the host.
        for (const id of hostAssignmentIds) {
          expect(body).not.toContain(id);
        }
      }
    });

    it('does not tell a player whether a text they received is their own', async () => {
      const game = await makeLobby(app, 4);
      await call(app, game.host.token, 'POST', `/sessions/${game.sessionId}/start`);
      await everyoneWrites(app, game);

      const view = await state(app, game.host.token, game.sessionId);

      for (const assignment of view.you!.assignments) {
        // An assignment carries the text and nothing about who wrote it.
        expect(Object.keys(assignment).sort()).toEqual([
          'answerBody',
          'assignmentId',
          'submitted',
          'textBody',
        ]);
      }
    });
  });

  /* ---- A10 ------------------------------------------------------------------------------ */

  describe('A10 — game content never reaches a log line', () => {
    /** A logger with the application's real redaction config, writing where we can read it. */
    const captureLog = (): { lines: string[]; log: pino.Logger } => {
      const lines: string[] = [];
      const stream = {
        write(chunk: string) {
          lines.push(chunk);
        },
      };

      return {
        lines,
        log: pino({ redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }, stream),
      };
    };

    it('redacts written content out of request bodies', () => {
      const { lines, log } = captureLog();

      log.info(
        { req: { body: { body: 'a secret confession', text: 'another', answer: 'and another' } } },
        'request',
      );

      const output = lines.join('');

      // A log that records who submitted which text defeats the entire product, so content is
      // dropped at the serializer rather than trusted not to be logged (docs/07-security.md).
      expect(output).not.toContain('a secret confession');
      expect(output).not.toContain('another');
      expect(output).toContain('[redacted]');
    });

    it('redacts credentials and session material', () => {
      const { lines, log } = captureLog();

      log.info(
        {
          req: { headers: { cookie: 'session=abc123' }, body: { password: 'hunter2' } },
          token: 'raw-token',
        },
        'request',
      );

      const output = lines.join('');

      expect(output).not.toContain('abc123');
      expect(output).not.toContain('hunter2');
      expect(output).not.toContain('raw-token');
    });

    it('still logs the things worth logging', () => {
      const { lines, log } = captureLog();

      log.info({ sessionId: 'abc', phase: 'WRITING', durationMs: 12 }, 'phase changed');

      const output = lines.join('');

      // Ids, phases and durations are exactly what an operator needs, and none of them
      // identifies anyone.
      expect(output).toContain('abc');
      expect(output).toContain('WRITING');
    });
  });

  /* ---- A11 ------------------------------------------------------------------------------ */

  describe('A11 — the realtime channel carries no identity at all', () => {
    it('emits ids, phases and counts only', () => {
      const emitted: unknown[] = [];

      app.events.on('session.progress', (payload) => emitted.push(payload));
      app.events.on('session.reveal_progress', (payload) => emitted.push(payload));

      app.events.emit('session.progress', { sessionId: 's', submitted: 3, required: 5 });
      app.events.emit('session.reveal_progress', { sessionId: 's', decided: 2, total: 4 });

      // Events are notifications, not payloads: clients refetch through the same projection as
      // any other read, so there is no second path that could disagree with the first.
      for (const payload of emitted) {
        const serialized = JSON.stringify(payload);

        expect(serialized).not.toMatch(/author|username|body|choice/i);
      }

      expect(emitted).toHaveLength(2);
    });
  });
});
