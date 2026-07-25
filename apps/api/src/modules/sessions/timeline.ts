import {
  computeRevealOutcome,
  projectTimeline,
  type AnswerRecord,
  type CommentRecord,
  type GuessRecord,
  type ParticipantVote,
  type PlayerRef,
  type RevealParticipant,
  type SessionPhase,
  type TextRecord,
} from '@aftergame/game-core';
import type { TimelineDto } from '@aftergame/shared';
import type { Answer, AuthorGuess, Comment, GameText, TextAssignment } from '@prisma/client';
import type { PlayerWithUser, SessionWithTheme } from './sessions.repository.js';

/**
 * The timeline read model.
 *
 * Deliberately **not** in `sessions.mapper.ts`, and the distinction is the point. A mapper turns
 * an entity into a payload, and must never touch an author id — a lint rule enforces exactly
 * that. This file does something different: it gathers raw records, author ids and all, and hands
 * them to `projectTimeline`, which is the one place entitled to decide whether a name is attached.
 *
 * Keeping the two apart means the rule stays strict where it matters, and the one file that
 * legitimately handles identity is the one that immediately gives it away.
 */

export interface TimelineSources {
  texts: GameText[];
  answers: (Answer & { assignment: TextAssignment })[];
  skipped: TextAssignment[];
  comments: Comment[];
  guesses: AuthorGuess[];
  players: PlayerWithUser[];
}

export function buildTimeline(
  session: SessionWithTheme,
  viewerPlayerId: string,
  sources: TimelineSources,
  votes: ParticipantVote[],
): TimelineDto {
  const participants: RevealParticipant[] = sources.players.map((player) => ({
    playerId: player.id,
    hasLeft: player.leftAt !== null,
  }));

  const playerRefs: PlayerRef[] = sources.players.map((player) => ({
    playerId: player.id,
    username: player.user.username,
  }));

  const texts: TextRecord[] = sources.texts.map((text) => ({
    id: text.id,
    body: text.body,
    authorPlayerId: text.authorPlayerId,
    displayOrder: text.displayOrder,
  }));

  const answers: AnswerRecord[] = [
    ...sources.answers.map((answer) => ({
      id: answer.id,
      textId: answer.assignment.textId,
      body: answer.body,
      authorPlayerId: answer.assignment.receiverPlayerId,
      skipped: false,
    })),
    // A skipped assignment still appears, as an absence. Dropping it would quietly hide that
    // somebody's text went unanswered (D14).
    ...sources.skipped.map((assignment) => ({
      id: assignment.id,
      textId: assignment.textId,
      body: null,
      authorPlayerId: assignment.receiverPlayerId,
      skipped: true,
    })),
  ];

  const comments: CommentRecord[] = sources.comments.map((comment) => ({
    id: comment.id,
    answerId: comment.answerId,
    body: comment.body,
    authorPlayerId: comment.authorPlayerId,
    isAnonymous: comment.isAnonymous,
    createdAt: comment.createdAt.toISOString(),
  }));

  const guesses: GuessRecord[] = sources.guesses.map((guess) => ({
    textId: guess.textId,
    guesserPlayerId: guess.guesserPlayerId,
    guessedPlayerId: guess.guessedPlayerId,
  }));

  return projectTimeline({
    phase: session.status satisfies SessionPhase,
    outcome: computeRevealOutcome(participants, votes),
    viewerPlayerId,
    players: playerRefs,
    texts,
    answers,
    comments,
    guesses,
  });
}
