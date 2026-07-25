/**
 * The session lifecycle.
 *
 * A game moves through a fixed sequence of phases, and what anyone may do depends entirely on
 * where it is. Expressing that as a transition table rather than a scattering of `if` statements
 * means an illegal move is rejected by construction, and the whole machine can be walked
 * exhaustively in a test.
 *
 * Specification: docs/01-architecture.md §4.
 */

export const SESSION_PHASES = [
  'LOBBY',
  'WRITING',
  'ANSWERING',
  'REVIEW',
  'REVEAL',
  'COMPLETED',
  'CANCELLED',
  'ABANDONED',
] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];

/** Once here, a session never moves again. */
export const TERMINAL_PHASES = ['COMPLETED', 'CANCELLED', 'ABANDONED'] as const;

export type TerminalPhase = (typeof TERMINAL_PHASES)[number];

/** Phases in which a session still occupies its group's "one live game" slot (D12). */
export const isTerminal = (phase: SessionPhase): phase is TerminalPhase =>
  (TERMINAL_PHASES as readonly SessionPhase[]).includes(phase);

export const isLive = (phase: SessionPhase): boolean => !isTerminal(phase);

/**
 * Every legal move, and nothing else.
 *
 * Abandonment is reachable from every live phase because a game whose players all walked away
 * must not hold its group's slot forever. `REVEAL` is deliberately not abandonable: by then the
 * game is played and only the vote remains, so it completes rather than evaporating.
 */
const TRANSITIONS: Readonly<Record<SessionPhase, readonly SessionPhase[]>> = {
  LOBBY: ['WRITING', 'CANCELLED', 'ABANDONED'],
  WRITING: ['ANSWERING', 'ABANDONED'],
  ANSWERING: ['REVIEW', 'ABANDONED'],
  REVIEW: ['REVEAL', 'ABANDONED'],
  REVEAL: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  ABANDONED: [],
};

export const canTransition = (from: SessionPhase, to: SessionPhase): boolean =>
  TRANSITIONS[from].includes(to);

export const transitionsFrom = (from: SessionPhase): readonly SessionPhase[] => TRANSITIONS[from];

/** The natural forward step — what "continue" means. Null once there is nowhere forward to go. */
export function nextPhase(from: SessionPhase): SessionPhase | null {
  const forward: Partial<Record<SessionPhase, SessionPhase>> = {
    LOBBY: 'WRITING',
    WRITING: 'ANSWERING',
    ANSWERING: 'REVIEW',
    REVIEW: 'REVEAL',
    REVEAL: 'COMPLETED',
  };

  return forward[from] ?? null;
}

/* ------------------------------------------------------------------------------------------ */
/* What anyone may do, in each phase                                                            */
/* ------------------------------------------------------------------------------------------ */

export const GAME_ACTIONS = [
  'join',
  'leave',
  'punish',
  'forgive',
  'configure',
  'start',
  'cancel',
  'submitText',
  'submitAnswer',
  'comment',
  'guess',
  'endGame',
  'castRevealVote',
  'closeVoting',
  'forceAdvance',
  'readTimeline',
] as const;

export type GameAction = (typeof GAME_ACTIONS)[number];

/** In a session, "host" means owner or co-host — they have identical powers (D16). */
export type GameRole = 'HOST' | 'PLAYER';

const PLAYER_ACTIONS: Readonly<Record<SessionPhase, readonly GameAction[]>> = {
  LOBBY: ['join', 'leave'],
  WRITING: ['submitText'],
  ANSWERING: ['submitAnswer'],
  REVIEW: ['readTimeline', 'comment', 'guess'],
  REVEAL: ['readTimeline', 'castRevealVote'],
  COMPLETED: ['readTimeline'],
  CANCELLED: [],
  ABANDONED: [],
};

/** What a host may do *in addition* to everything a player may do. */
const HOST_EXTRA_ACTIONS: Readonly<Record<SessionPhase, readonly GameAction[]>> = {
  LOBBY: ['punish', 'forgive', 'configure', 'start', 'cancel'],
  // Force-advance exists so one absent player cannot freeze a game forever (D14).
  WRITING: ['forceAdvance'],
  ANSWERING: ['forceAdvance'],
  REVIEW: ['endGame'],
  REVEAL: ['closeVoting'],
  COMPLETED: [],
  CANCELLED: [],
  ABANDONED: [],
};

export function allowedActions(phase: SessionPhase, role: GameRole): readonly GameAction[] {
  const base = PLAYER_ACTIONS[phase];

  return role === 'HOST' ? [...base, ...HOST_EXTRA_ACTIONS[phase]] : base;
}

export const isActionAllowed = (phase: SessionPhase, role: GameRole, action: GameAction): boolean =>
  allowedActions(phase, role).includes(action);

/* ------------------------------------------------------------------------------------------ */
/* Guards for the transitions that have preconditions                                           */
/* ------------------------------------------------------------------------------------------ */

/** The brief's floor. Two people is the smallest game that is a game at all. */
export const MIN_PLAYERS_PER_SESSION = 2;

export interface StartCheck {
  /** Members eligible to play — those not blocked by three consecutive punishments (D7). */
  eligiblePlayerCount: number;
}

export const canStart = ({ eligiblePlayerCount }: StartCheck): boolean =>
  eligiblePlayerCount >= MIN_PLAYERS_PER_SESSION;

export interface ProgressCheck {
  submitted: number;
  required: number;
  /** A host pressing "skip and continue". */
  forced: boolean;
}

/**
 * May the writing phase end?
 *
 * Normally when everyone has written. A host may also force it — but never down to fewer than two
 * texts, because a game with one text has nothing to distribute (D14).
 */
export const canAdvanceFromWriting = ({ submitted, required, forced }: ProgressCheck): boolean =>
  forced ? submitted >= MIN_PLAYERS_PER_SESSION : submitted >= required && required > 0;

/**
 * May the answering phase end?
 *
 * Forcing here is safe at any count: unanswered assignments simply show as "no answer" in the
 * timeline, and a timeline with nothing in it is a dull game rather than a broken one.
 */
export const canAdvanceFromAnswering = ({ submitted, required, forced }: ProgressCheck): boolean =>
  forced || (submitted >= required && required > 0);
