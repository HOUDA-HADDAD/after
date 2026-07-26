import { randomBytes } from 'node:crypto';
import {
  canAdvanceFromAnswering,
  canAdvanceFromWriting,
  canStart,
  canTransition,
  demandFor,
  distribute,
  computeRevealOutcome,
  isBlocked,
  isPunishmentLevel,
  resetIfUnpunished,
  seededRng,
  type ParticipantVote,
  type PlayablePunishmentLevel,
  type SessionPhase,
} from '@aftergame/game-core';
import {
  ConflictError,
  ERROR_CODES,
  ForbiddenError,
  NotFoundError,
  type SessionStateDto,
} from '@aftergame/shared';
import type { Env } from '@aftergame/config';
import type { SessionStatus } from '@prisma/client';
import { assertCan } from '../../lib/authorize.js';
import type { EventBus } from '../../lib/event-bus.js';
import type { TransactionRunner } from '../../plugins/prisma.js';
import { requireActor } from '../groups/group-access.js';
import { createGroupsRepository, type GroupsRepository } from '../groups/groups.repository.js';
import { createPunishmentsRepository } from '../punishments/punishments.repository.js';
import {
  createSessionsRepository,
  type PlayerWithUser,
  type SessionsRepository,
  type SessionWithTheme,
} from './sessions.repository.js';
import type { ThemesRepository } from '../themes/themes.repository.js';
import type { ReactionsRepository } from './reactions.repository.js';
import { toSessionStateDto } from './sessions.mapper.js';
import { buildTimeline } from './timeline.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** A 63-bit seed, stored on the session so any distribution can be replayed from it. */
const newSeed = (): bigint => BigInt.asUintN(63, randomBytes(8).readBigUInt64BE());

export interface SessionsServiceDeps {
  sessions: SessionsRepository;
  reactions: ReactionsRepository;
  themes: ThemesRepository;
  groups: GroupsRepository;
  transaction: TransactionRunner;
  events: EventBus;
  env: Env;
  now?: () => Date;
}

export function createSessionsService({
  sessions,
  reactions,
  themes,
  groups,
  transaction,
  events,
  env,
  now = () => new Date(),
}: SessionsServiceDeps) {
  /* ---- shared lookups ------------------------------------------------------------------ */

  /** Load a session the viewer is entitled to see, or 404. Membership decides, not participation. */
  const requireSession = async (
    sessionId: string,
    userId: string,
  ): Promise<{ session: SessionWithTheme; isHost: boolean }> => {
    const session = await sessions.findById(sessionId);

    if (session === null) {
      throw new NotFoundError(ERROR_CODES.SESSION_GONE, 'That game has ended and been deleted.');
    }

    const actor = await requireActor(groups, session.groupId, userId);
    assertCan('session:read', actor);

    return { session, isHost: actor.role !== 'MEMBER' };
  };

  const requireHost = async (sessionId: string, userId: string) => {
    const { session, isHost } = await requireSession(sessionId, userId);

    if (!isHost) {
      throw new ForbiddenError(ERROR_CODES.FORBIDDEN, 'Only a host can do that.');
    }

    return session;
  };

  const requirePhase = (session: SessionWithTheme, expected: SessionStatus): void => {
    if (session.status !== expected) {
      throw new ConflictError(
        ERROR_CODES.SESSION_PHASE_INVALID,
        'The game has already moved on',
        `Expected the game to be in ${expected.toLowerCase()}.`,
      );
    }
  };

  const announcePhase = (session: SessionWithTheme, phase: SessionPhase): void => {
    events.emit('session.phase_changed', {
      sessionId: session.id,
      groupId: session.groupId,
      phase,
    });
    events.emit('group.session_changed', { groupId: session.groupId });
  };

  /** Aggregate counts only — "6 of 8", never "Sarah submitted" (docs/01-architecture.md §3). */
  const announceProgress = async (session: SessionWithTheme): Promise<void> => {
    const [submitted, required] =
      session.status === 'WRITING'
        ? [await sessions.countSubmittedTexts(session.id), session.requiredTextCount]
        : [
            await sessions.countSubmittedAnswers(session.id),
            await sessions.countAssignments(session.id),
          ];

    events.emit('session.progress', { sessionId: session.id, submitted, required });
  };

  /* ---- the distribution critical section ------------------------------------------------ */

  /**
   * Close writing, hand out the texts, and open answering.
   *
   * Runs **exactly once**, however many callers race for it. The session row is taken `FOR UPDATE`
   * first, so a second caller blocks until the first commits and then finds the phase already
   * advanced — no duplicate assignments, no lost update, and no retry loop, because the lock
   * serialises rather than aborting. Row locking is sufficient here and cheaper than serialisable
   * isolation, which would turn every race into a retry the caller has to handle.
   *
   * Returns true if this call is the one that did it.
   */
  const runDistribution = async (sessionId: string, forced: boolean): Promise<boolean> =>
    transaction(async (tx) => {
      const scoped = createSessionsRepository(tx);

      await scoped.lockForUpdate(sessionId);

      const session = await scoped.findById(sessionId);
      // Someone else won the race and has already moved the game on.
      if (session === null || session.status !== 'WRITING') return false;

      const submitted = await scoped.listSubmittedTexts(sessionId);

      if (
        !canAdvanceFromWriting({
          submitted: submitted.length,
          required: session.requiredTextCount,
          forced,
        })
      ) {
        return false;
      }

      const players = await scoped.listPlayers(sessionId);
      const rng = seededRng(session.displaySeed);

      // Display order is decided here, once, from the seed — never from submission order, which
      // would identify the quickest typist.
      for (const [index, text] of rng.shuffle(submitted).entries()) {
        await scoped.setDisplayOrder(text.id, index);
      }

      // A forced advance discards unfinished drafts; they never reach the timeline.
      await scoped.deleteDraftTexts(sessionId);

      const scopedGroups = createGroupsRepository(tx);

      /**
       * The load is computed **here**, from the level each player actually starts the game with.
       *
       * A host may punish somebody after they joined the lobby, so a snapshot taken at join time
       * would under-punish them (D6). Reading the membership now, and freezing it onto the player
       * row, is what makes the load fixed for the rest of the game.
       */
      const demands = await Promise.all(
        players.map(async (player) => {
          const membership = await scopedGroups.findMembership(session.groupId, player.userId);
          const level = membership?.consecutivePunishments ?? 0;

          const playable: PlayablePunishmentLevel =
            isPunishmentLevel(level) && !isBlocked(level) ? (level as PlayablePunishmentLevel) : 0;

          return {
            id: player.id,
            level: playable,
            demand: demandFor(playable, submitted.length),
          };
        }),
      );

      const assignments = distribute({
        texts: submitted.map((text) => ({ id: text.id, authorPlayerId: text.authorPlayerId })),
        players: demands.map(({ id, demand }) => ({ id, demand })),
        seed: session.distributionSeed,
      });

      await scoped.createAssignments(sessionId, assignments);

      for (const entry of demands) {
        await scoped.setDistributionSnapshot(entry.id, entry.level, entry.demand);
      }

      return scoped.advanceStatus(sessionId, 'WRITING', 'ANSWERING');
    });

  /* ---- completion ----------------------------------------------------------------------- */

  /**
   * Finish the game: settle punishment counters, then set the purge clock.
   *
   * "After playing a normal game without punishment: reset punishment counter to zero" (D5). The
   * reset and its audit row go in the same transaction as the phase change, so a completed game
   * can never leave counters half-settled.
   */
  const completeSession = async (session: SessionWithTheme): Promise<boolean> =>
    transaction(async (tx) => {
      const scoped = createSessionsRepository(tx);
      const scopedGroups = createGroupsRepository(tx);
      const scopedPunishments = createPunishmentsRepository(tx);

      await scoped.lockForUpdate(session.id);

      const current = await scoped.findById(session.id);
      if (current === null || current.status !== 'REVEAL') return false;

      const players = await scoped.listPlayers(session.id);

      for (const player of players) {
        const membership = await scopedGroups.findMembership(session.groupId, player.userId);
        if (membership === null) continue;

        const level = membership.consecutivePunishments;
        if (!isPunishmentLevel(level)) continue;

        const next = resetIfUnpunished(level, player.wasPunishedThisSession);
        if (next === level) continue;

        const moved = await scopedPunishments.compareAndSetLevel(
          session.groupId,
          player.userId,
          level,
          next,
          'ACTIVE',
        );

        if (moved) {
          await scopedPunishments.recordEvent({
            groupId: session.groupId,
            targetUserId: player.userId,
            actorUserId: player.userId,
            action: 'AUTO_RESET',
            resultingLevel: next,
            gameSessionId: session.id,
          });
        }
      }

      return scoped.advanceStatus(session.id, 'REVEAL', 'COMPLETED', {
        endedAt: now(),
        purgeAfter: new Date(now().getTime() + env.SESSION_GRACE_HOURS * MILLISECONDS_PER_HOUR),
      });
    });

  /* ---- public API ------------------------------------------------------------------------ */

  return {
    async create(groupId: string, userId: string, themeId: string): Promise<SessionStateDto> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('session:create', actor);

      if ((await sessions.findLiveForGroup(groupId)) !== null) {
        throw new ConflictError(
          ERROR_CODES.SESSION_ALREADY_ACTIVE,
          'A game is already running in this group',
          'End it before starting another.',
        );
      }

      const membership = await groups.findMembership(groupId, userId);
      if (membership === null) throw new NotFoundError();

      /**
       * A group may only play the defaults and its own themes (D19).
       *
       * Without this, a theme id from another group would be accepted by a foreign-key constraint
       * that has no opinion about who owns what — and that group's prompt would be pinned to the
       * banner of a game it has nothing to do with.
       */
      const theme = await themes.findById(themeId);

      if (theme === null || (theme.groupId !== null && theme.groupId !== groupId)) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such theme.');
      }

      const session = await sessions.create({
        groupId,
        themeId,
        createdById: userId,
        distributionSeed: newSeed(),
        displaySeed: newSeed(),
      });

      // The host is a player too; creating a game is not the same as sitting out of it.
      await sessions.addPlayer(
        session.id,
        userId,
        membership.id,
        membership.consecutivePunishments,
      );

      events.emit('group.session_changed', { groupId });

      return this.getState(session.id, userId);
    },

    async join(sessionId: string, userId: string): Promise<SessionStateDto> {
      const { session } = await requireSession(sessionId, userId);
      const actor = await requireActor(groups, session.groupId, userId);
      assertCan('session:join', actor);

      const existing = await sessions.findPlayer(sessionId, userId);
      if (existing !== null) return this.getState(sessionId, userId);

      // "Players cannot join after the beginning" — the roster locks at start (D13).
      if (session.status !== 'LOBBY') {
        throw new ConflictError(
          ERROR_CODES.SESSION_ROSTER_LOCKED,
          'This game has already started',
          'Wait for the next one.',
        );
      }

      const membership = await groups.findMembership(session.groupId, userId);
      if (membership === null) throw new NotFoundError();

      // Three consecutive punishments bars them from games until a host forgives (D7).
      if (membership.status === 'GAME_BLOCKED') {
        throw new ForbiddenError(
          ERROR_CODES.MEMBER_GAME_BLOCKED,
          'You cannot join games in this group until a host forgives you.',
        );
      }

      if ((await sessions.listPlayers(sessionId)).length >= env.MAX_SESSION_PLAYERS) {
        throw new ConflictError(ERROR_CODES.CONFLICT, 'This game is full');
      }

      await sessions.addPlayer(sessionId, userId, membership.id, membership.consecutivePunishments);

      events.emit('session.roster_changed', { sessionId, groupId: session.groupId });

      return this.getState(sessionId, userId);
    },

    async leave(sessionId: string, userId: string): Promise<void> {
      const { session } = await requireSession(sessionId, userId);
      const player = await sessions.findPlayer(sessionId, userId);
      if (player === null) return;

      if (session.status === 'LOBBY') {
        // Before the roster locks, leaving removes you outright.
        await sessions.removePlayer(player.id);
      } else {
        // Afterwards you stay on the roster — you owe a text — but drop out of the reveal
        // denominator so one person walking away cannot block the vote forever (D8).
        await sessions.markPlayerLeft(player.id, now());
      }

      events.emit('session.roster_changed', { sessionId, groupId: session.groupId });
    },

    async cancel(sessionId: string, userId: string): Promise<void> {
      const session = await requireHost(sessionId, userId);
      requirePhase(session, 'LOBBY');

      if (!canTransition('LOBBY', 'CANCELLED')) return;

      await sessions.advanceStatus(sessionId, 'LOBBY', 'CANCELLED', { endedAt: now() });
      announcePhase(session, 'CANCELLED');
    },

    async start(sessionId: string, userId: string): Promise<SessionStateDto> {
      const session = await requireHost(sessionId, userId);
      requirePhase(session, 'LOBBY');

      // Someone punished to the third level *after* joining the lobby is no longer eligible, so
      // the roster is filtered rather than merely checked (D7).
      for (const player of await sessions.listPlayers(sessionId)) {
        const membership = await groups.findMembership(session.groupId, player.userId);

        if (membership === null || membership.status === 'GAME_BLOCKED') {
          await sessions.removePlayer(player.id);
        }
      }

      const players = await sessions.listPlayers(sessionId);

      if (!canStart({ eligiblePlayerCount: players.length })) {
        throw new ConflictError(
          ERROR_CODES.SESSION_TOO_FEW_PLAYERS,
          'You need at least two players to start',
        );
      }

      // The roster locks here, and the required text count is fixed with it: one text per
      // participant, always (D1).
      await sessions.advanceStatus(sessionId, 'LOBBY', 'WRITING', {
        startedAt: now(),
        requiredTextCount: players.length,
      });

      announcePhase(session, 'WRITING');

      return this.getState(sessionId, userId);
    },

    /** Called after every text submission; advances only when the guard says so. */
    async maybeAdvanceFromWriting(session: SessionWithTheme): Promise<void> {
      if (await runDistribution(session.id, false)) {
        announcePhase(session, 'ANSWERING');
      }
    },

    async maybeAdvanceFromAnswering(session: SessionWithTheme): Promise<void> {
      const [submitted, required] = [
        await sessions.countSubmittedAnswers(session.id),
        await sessions.countAssignments(session.id),
      ];

      if (!canAdvanceFromAnswering({ submitted, required, forced: false })) return;

      if (await sessions.advanceStatus(session.id, 'ANSWERING', 'REVIEW')) {
        announcePhase(session, 'REVIEW');
      }
    },

    /** "Skip and continue" — the control that stops one absent player freezing a game (D14). */
    async forceAdvance(sessionId: string, userId: string): Promise<SessionStateDto> {
      const session = await requireHost(sessionId, userId);

      if (session.status === 'WRITING') {
        if (!(await runDistribution(sessionId, true))) {
          throw new ConflictError(
            ERROR_CODES.SESSION_PHASE_INVALID,
            'Not enough texts to continue',
            'At least two players need to have written something.',
          );
        }

        announcePhase(session, 'ANSWERING');
      } else if (session.status === 'ANSWERING') {
        await sessions.markUnansweredSkipped(sessionId);

        if (await sessions.advanceStatus(sessionId, 'ANSWERING', 'REVIEW')) {
          announcePhase(session, 'REVIEW');
        }
      } else {
        throw new ConflictError(
          ERROR_CODES.SESSION_PHASE_INVALID,
          'There is nothing to skip right now',
        );
      }

      return this.getState(sessionId, userId);
    },

    /** The host ends the game; the reveal vote opens. */
    async endGame(sessionId: string, userId: string): Promise<SessionStateDto> {
      const session = await requireHost(sessionId, userId);
      requirePhase(session, 'REVIEW');

      if (await sessions.advanceStatus(sessionId, 'REVIEW', 'REVEAL')) {
        announcePhase(session, 'REVEAL');
      }

      return this.getState(sessionId, userId);
    },

    async closeVoting(sessionId: string, userId: string): Promise<SessionStateDto> {
      const session = await requireHost(sessionId, userId);
      requirePhase(session, 'REVEAL');

      if (await completeSession(session)) announcePhase(session, 'COMPLETED');

      return this.getState(sessionId, userId);
    },

    /** Everyone has voted — settle without waiting for the host. */
    async maybeCompleteAfterVote(session: SessionWithTheme): Promise<void> {
      const players = await sessions.listPlayers(session.id);
      const votes = await sessions.listRevealVotes(session.id);

      const outcome = computeRevealOutcome(
        players.map((player) => ({ playerId: player.id, hasLeft: player.leftAt !== null })),
        votes.map((vote): ParticipantVote => ({ playerId: vote.playerId, choice: vote.choice })),
      );

      events.emit('session.reveal_progress', {
        sessionId: session.id,
        decided: outcome.decided,
        total: outcome.total,
      });

      if (outcome.everyoneDecided && (await completeSession(session))) {
        announcePhase(session, 'COMPLETED');
      }
    },

    async announceProgressFor(session: SessionWithTheme): Promise<void> {
      await announceProgress(session);
    },

    requireSession,
    requirePhase,

    /**
     * The full snapshot.
     *
     * Used on load and after every reconnect, which is what makes a dropped socket a two-second
     * pause rather than a broken game (docs/01-architecture.md §7).
     */
    async getState(sessionId: string, userId: string): Promise<SessionStateDto> {
      const { session, isHost } = await requireSession(sessionId, userId);

      const players = await sessions.listPlayers(sessionId);
      const viewerPlayer = players.find((player) => player.userId === userId) ?? null;

      const draftText =
        viewerPlayer === null ? null : await sessions.findTextByAuthor(sessionId, viewerPlayer.id);

      const assignments =
        viewerPlayer === null ? [] : await sessions.listAssignmentsForPlayer(viewerPlayer.id);

      const progress =
        session.status === 'LOBBY' || session.status === 'WRITING'
          ? {
              submitted: await sessions.countSubmittedTexts(sessionId),
              required: session.requiredTextCount,
            }
          : {
              submitted: await sessions.countSubmittedAnswers(sessionId),
              required: await sessions.countAssignments(sessionId),
            };

      const showsTimeline = ['REVIEW', 'REVEAL', 'COMPLETED'].includes(session.status);
      const votes = showsTimeline ? await sessions.listRevealVotes(sessionId) : [];

      const participantVotes = votes.map((vote): ParticipantVote => ({
        playerId: vote.playerId,
        choice: vote.choice,
      }));

      const outcome = computeRevealOutcome(
        players.map((player) => ({ playerId: player.id, hasLeft: player.leftAt !== null })),
        participantVotes,
      );

      const timeline =
        showsTimeline && viewerPlayer !== null
          ? buildTimeline(
              session,
              viewerPlayer.id,
              {
                texts: await sessions.listSubmittedTexts(sessionId),
                answers: await sessions.listAnswers(sessionId),
                skipped: await sessions.listSkippedAssignments(sessionId),
                comments: await sessions.listComments(sessionId),
                guesses: await sessions.listGuesses(sessionId),
                reactions: await reactions.tallyForSession(sessionId, viewerPlayer.id),
                players,
              },
              participantVotes,
            )
          : null;

      return toSessionStateDto({
        session,
        players,
        viewerUserId: userId,
        viewerPlayer,
        isHost,
        draftText,
        assignments,
        progress,
        revealVoteCast: viewerPlayer === null ? false : await sessions.hasVoted(viewerPlayer.id),
        // Only counts, never the split (D8a).
        reveal:
          session.status === 'REVEAL' || session.status === 'COMPLETED'
            ? {
                decided: outcome.decided,
                total: outcome.total,
                closed: session.status === 'COMPLETED',
                revealed: session.status === 'COMPLETED' && outcome.revealed,
              }
            : null,
        timeline,
      });
    },

    /** The live game in a group, if any — used by the group screen. */
    async liveForGroup(groupId: string, userId: string): Promise<SessionStateDto | null> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('session:read', actor);

      const live = await sessions.findLiveForGroup(groupId);

      return live === null ? null : this.getState(live.id, userId);
    },

    /** Participant lookup for the gameplay service, which needs the same guards. */
    async requirePlayer(sessionId: string, userId: string): Promise<PlayerWithUser> {
      const players = await sessions.listPlayers(sessionId);
      const player = players.find((entry) => entry.userId === userId);

      if (player === undefined) {
        throw new ForbiddenError(ERROR_CODES.FORBIDDEN, 'You are not playing in this game.');
      }

      return player;
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
