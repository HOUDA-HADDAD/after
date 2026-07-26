import { ConflictError, ERROR_CODES, ForbiddenError, NotFoundError } from '@aftergame/shared';
import type { SessionStateDto } from '@aftergame/shared';
import { isActionAllowed, type SessionPhase } from '@aftergame/game-core';
import type { EventBus } from '../../lib/event-bus.js';
import type { ReactionsRepository } from './reactions.repository.js';
import type { SessionsRepository } from './sessions.repository.js';
import type { SessionsService } from './sessions.service.js';

export interface GameplayServiceDeps {
  sessions: SessionsRepository;
  reactions: ReactionsRepository;
  lifecycle: SessionsService;
  events: EventBus;
}

/**
 * What players do inside a game: write, answer, comment, guess, vote.
 *
 * Each of these is gated the same way — the right phase, and the caller's own resource. "Your
 * own" is the important half: you may submit *your* text and answer *your* assignment, and there
 * is no endpoint that reaches anyone else's.
 */
export function createGameplayService({
  sessions,
  reactions,
  lifecycle,
  events,
}: GameplayServiceDeps) {
  const assertPhaseAllows = (
    phase: SessionPhase,
    action: 'submitText' | 'submitAnswer' | 'comment' | 'guess' | 'castRevealVote',
  ): void => {
    if (!isActionAllowed(phase, 'PLAYER', action)) {
      throw new ConflictError(
        ERROR_CODES.SESSION_PHASE_INVALID,
        'The game has already moved on',
        'That is not something you can do right now.',
      );
    }
  };

  return {
    /**
     * Save or submit the player's one text.
     *
     * Drafts autosave so a dropped connection loses nothing; submitting is final, because
     * "users can edit their text before final submission" and not after.
     */
    async writeText(
      sessionId: string,
      userId: string,
      body: string,
      submit: boolean,
    ): Promise<SessionStateDto> {
      const { session } = await lifecycle.requireSession(sessionId, userId);
      assertPhaseAllows(session.status, 'submitText');

      const player = await lifecycle.requirePlayer(sessionId, userId);
      const existing = await sessions.findTextByAuthor(sessionId, player.id);

      if (existing?.status === 'SUBMITTED') {
        throw new ConflictError(
          ERROR_CODES.ALREADY_SUBMITTED,
          'You have already submitted your text',
        );
      }

      // Display order is decided later, from the seed, when writing closes — never here, where
      // it would encode submission order.
      await sessions.upsertText(sessionId, player.id, body, submit, 0);
      await sessions.touch(sessionId);

      if (submit) {
        await lifecycle.announceProgressFor(session);
        await lifecycle.maybeAdvanceFromWriting(session);
      }

      return lifecycle.getState(sessionId, userId);
    },

    /** Save or submit an answer to one of the texts this player was given. */
    async writeAnswer(
      sessionId: string,
      userId: string,
      assignmentId: string,
      body: string,
      submit: boolean,
    ): Promise<SessionStateDto> {
      const { session } = await lifecycle.requireSession(sessionId, userId);
      assertPhaseAllows(session.status, 'submitAnswer');

      const player = await lifecycle.requirePlayer(sessionId, userId);
      const assignment = await sessions.findAssignment(assignmentId);

      if (assignment === null || assignment.sessionId !== sessionId) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such assignment.');
      }

      // Someone else's assignment is not yours to answer — and asking for it must not reveal
      // that it exists in a form you could correlate.
      if (assignment.receiverPlayerId !== player.id) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such assignment.');
      }

      if (assignment.answer?.status === 'SUBMITTED') {
        throw new ConflictError(ERROR_CODES.ALREADY_SUBMITTED, 'You have already answered that');
      }

      await sessions.upsertAnswer(assignmentId, sessionId, body, submit);
      await sessions.touch(sessionId);

      if (submit) {
        await lifecycle.announceProgressFor(session);
        await lifecycle.maybeAdvanceFromAnswering(session);
      }

      return lifecycle.getState(sessionId, userId);
    },

    /** Comment on an answer. Anonymous by default, and anonymity here is permanent (D17). */
    async comment(
      sessionId: string,
      userId: string,
      answerId: string,
      body: string,
      isAnonymous: boolean,
    ): Promise<void> {
      const { session } = await lifecycle.requireSession(sessionId, userId);
      assertPhaseAllows(session.status, 'comment');

      // Comments exist because the theme's capability flag says so, not because of its slug (D15).
      if (!session.theme.supportsComments) {
        throw new ForbiddenError(ERROR_CODES.FORBIDDEN, 'This theme does not have comments.');
      }

      const player = await lifecycle.requirePlayer(sessionId, userId);
      const answer = await sessions.findAnswerById(answerId);

      if (answer === null || answer.sessionId !== sessionId) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such answer.');
      }

      await sessions.createComment(sessionId, answerId, player.id, body, isAnonymous);
      await sessions.touch(sessionId);

      events.emit('timeline.comment_added', { sessionId, answerId });
    },

    /**
     * React to an answer, or take the reaction back (D20).
     *
     * A toggle rather than separate add and remove endpoints, because that is what the button
     * does — and it makes a double tap harmless: the unique index means adding twice is one row,
     * and removing something that is not there is not an error.
     *
     * Reacting is allowed wherever commenting is, and gated on the same capability flag: a theme
     * without a discussion has nothing to react to.
     */
    async react(
      sessionId: string,
      userId: string,
      answerId: string,
      emoji: string,
      on: boolean,
    ): Promise<void> {
      const { session } = await lifecycle.requireSession(sessionId, userId);
      assertPhaseAllows(session.status, 'comment');

      if (!session.theme.supportsComments) {
        throw new ForbiddenError(ERROR_CODES.FORBIDDEN, 'This theme does not have reactions.');
      }

      const player = await lifecycle.requirePlayer(sessionId, userId);

      if (!(await reactions.answerBelongsToSession(answerId, sessionId))) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such answer.');
      }

      // Scoped to this player either way, so a request can only ever change the caller's own.
      const changed = on
        ? await reactions.add(sessionId, answerId, player.id, emoji)
        : await reactions.remove(answerId, player.id, emoji);

      // Nothing changed means the tally is already what the caller asked for; telling the room to
      // refetch would be pure noise.
      if (!changed) return;

      await sessions.touch(sessionId);

      events.emit('timeline.comment_added', { sessionId, answerId });
    },

    /** Guess who wrote a text. Changeable until the review phase closes. */
    async guess(
      sessionId: string,
      userId: string,
      textId: string,
      guessedPlayerId: string,
    ): Promise<void> {
      const { session } = await lifecycle.requireSession(sessionId, userId);
      assertPhaseAllows(session.status, 'guess');

      if (!session.theme.supportsAuthorGuess) {
        throw new ForbiddenError(ERROR_CODES.FORBIDDEN, 'This theme does not have guessing.');
      }

      const player = await lifecycle.requirePlayer(sessionId, userId);
      const texts = await sessions.listSubmittedTexts(sessionId);

      if (!texts.some((text) => text.id === textId)) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such text.');
      }

      const players = await sessions.listPlayers(sessionId);
      if (!players.some((entry) => entry.id === guessedPlayerId)) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such player.');
      }

      await sessions.upsertGuess(sessionId, textId, player.id, guessedPlayerId);
      await sessions.touch(sessionId);
    },

    /**
     * Cast the private reveal vote.
     *
     * Nothing about the choice is echoed back — not to the caller's own client beyond "you have
     * voted", and never to anyone else. The response carries `decided / total` and no more (D8a).
     */
    async castRevealVote(
      sessionId: string,
      userId: string,
      choice: 'YES' | 'NO',
    ): Promise<SessionStateDto> {
      const { session } = await lifecycle.requireSession(sessionId, userId);
      assertPhaseAllows(session.status, 'castRevealVote');

      const player = await lifecycle.requirePlayer(sessionId, userId);

      await sessions.castRevealVote(sessionId, player.id, choice);
      await sessions.touch(sessionId);

      await lifecycle.maybeCompleteAfterVote(session);

      return lifecycle.getState(sessionId, userId);
    },
  };
}

export type GameplayService = ReturnType<typeof createGameplayService>;
