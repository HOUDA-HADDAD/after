/**
 * The wire shape of a game.
 *
 * One rule governs every type here: **no field ever carries an author identifier unless the
 * viewer is entitled to it.** Where identity is not permitted the field is `null` — never present
 * but hidden, because a value in a JSON payload is not hidden at all (docs/01-architecture.md §3).
 */

export type SessionPhaseDto =
  'LOBBY' | 'WRITING' | 'ANSWERING' | 'REVIEW' | 'REVEAL' | 'COMPLETED' | 'CANCELLED' | 'ABANDONED';

export interface SessionThemeDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  writePrompt: string;
  writePlaceholder: string;
  answerPrompt: string;
  icon: string;
  supportsComments: boolean;
  supportsAuthorGuess: boolean;
}

/** A participant, as everyone sees them. Being on the roster is not secret; what you wrote is. */
export interface SessionPlayerDto {
  playerId: string;
  username: string;
  isYou: boolean;
  hasLeft: boolean;
  /** Answer load for this game — visible because it is a rule, not a secret (D6). */
  answerLoad: number;
}

/** One text this player must answer, with their own answer to it. */
export interface AssignmentDto {
  assignmentId: string;
  textBody: string;
  answerBody: string;
  submitted: boolean;
}

/** Everything about the viewer's own position. Never includes anyone else's private state. */
export interface ViewerStateDto {
  playerId: string;
  isHost: boolean;
  /** Their own draft, which only they can see. */
  draftText: string;
  textSubmitted: boolean;
  assignments: AssignmentDto[];
  revealVoteCast: boolean;
}

export interface ProgressDto {
  submitted: number;
  required: number;
}

/**
 * Reveal progress.
 *
 * `decided` and `total` only. The yes/no split is never sent, because in a small group it
 * identifies whoever refused — and in a two-player game it identifies them exactly (D8a).
 */
export interface RevealProgressDto {
  decided: number;
  total: number;
  /** True once voting has closed and the outcome is settled. */
  closed: boolean;
  /** Whether authors ended up revealed. Meaningless until `closed`. */
  revealed: boolean;
}

export interface PlayerRefDto {
  playerId: string;
  username: string;
}

export interface TimelineCommentDto {
  id: string;
  body: string;
  /** Null for an anonymous comment — forever, for everyone, in every phase. */
  author: PlayerRefDto | null;
  createdAt: string;
}

export interface TimelineAnswerDto {
  id: string;
  body: string | null;
  author: PlayerRefDto | null;
  skipped: boolean;
  comments: TimelineCommentDto[];
}

export interface TimelineTextDto {
  id: string;
  body: string;
  author: PlayerRefDto | null;
  answers: TimelineAnswerDto[];
  yourGuess: PlayerRefDto | null;
  yourGuessCorrect: boolean | null;
}

export interface TimelineDto {
  authorsVisible: boolean;
  texts: TimelineTextDto[];
  guessScores: { player: PlayerRefDto; correct: number; total: number }[] | null;
}

export interface SessionStateDto {
  id: string;
  groupId: string;
  phase: SessionPhaseDto;
  theme: SessionThemeDto;
  players: SessionPlayerDto[];
  progress: ProgressDto;
  /** Null when the viewer is a group member watching a game they are not in. */
  you: ViewerStateDto | null;
  /** Present from the reveal phase onwards. */
  reveal: RevealProgressDto | null;
  /** Present once there is a timeline to read. */
  timeline: TimelineDto | null;
  /** When the finished game will be deleted (D11). */
  purgeAfter: string | null;
  createdAt: string;
}

/** The lightweight shape used to advertise a live game inside a group. */
export interface SessionSummaryDto {
  id: string;
  phase: SessionPhaseDto;
  themeName: string;
  playerCount: number;
  youArePlaying: boolean;
}
