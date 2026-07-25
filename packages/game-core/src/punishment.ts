/**
 * The punishment rules.
 *
 * Punishment is group-local and consecutive: a host can raise a player's level before a game, and
 * playing a game *without* being punished clears it. At level 3 the player keeps full access to
 * the group but cannot be put on a roster until a host forgives them.
 *
 * Every function here is pure. That is what lets the whole state machine be proven by generated
 * sequences rather than by a handful of examples — see tests/punishment.test.ts.
 *
 * Specification: docs/00-spec-decisions.md D3, D5, D6, D7.
 */

export const MIN_PUNISHMENT_LEVEL = 0;
export const MAX_PUNISHMENT_LEVEL = 3;

/** At this level the player is barred from games until forgiven. */
export const BLOCKED_PUNISHMENT_LEVEL = 3;

export type PunishmentLevel = 0 | 1 | 2 | 3;

/**
 * A level a player can actually take into a game.
 *
 * Level 3 is deliberately absent: a blocked player never reaches a roster, so `demandFor` cannot
 * be handed one by mistake. The type does the work a runtime guard would otherwise have to.
 */
export type PlayablePunishmentLevel = 0 | 1 | 2;

export type MembershipStatus = 'ACTIVE' | 'GAME_BLOCKED';

export const isPunishmentLevel = (value: number): value is PunishmentLevel =>
  Number.isInteger(value) && value >= MIN_PUNISHMENT_LEVEL && value <= MAX_PUNISHMENT_LEVEL;

/** Level 3 and `GAME_BLOCKED` are the same fact; a CHECK constraint stops them disagreeing. */
export const isBlocked = (level: PunishmentLevel): boolean => level === BLOCKED_PUNISHMENT_LEVEL;

export const statusFor = (level: PunishmentLevel): MembershipStatus =>
  isBlocked(level) ? 'GAME_BLOCKED' : 'ACTIVE';

export const isPlayable = (level: PunishmentLevel): level is PlayablePunishmentLevel =>
  !isBlocked(level);

/**
 * How many texts this player must answer.
 *
 * Level 0 answers one, level 1 answers two, level 2 answers three — **clamped to the number of
 * texts in play**. The clamp is not a nicety: a player at level 2 in a two-player game owes three
 * answers, but only two texts exist and nobody may receive the same text twice (D2). Without the
 * clamp, distribution has no solution and the game hard-locks (D3).
 */
export function demandFor(level: PlayablePunishmentLevel, textCount: number): number {
  const wanted = 1 + level;

  return Math.max(0, Math.min(wanted, textCount));
}

/** Did the clamp bite? The lobby says so plainly rather than silently under-punishing. */
export const isDemandClamped = (level: PlayablePunishmentLevel, textCount: number): boolean =>
  demandFor(level, textCount) < 1 + level;

/** Raise the level by one. Already at the maximum, it stays there — punishing harder is not a thing. */
export const escalate = (level: PunishmentLevel): PunishmentLevel =>
  (isBlocked(level) ? level : level + 1) as PunishmentLevel;

/** Nothing to escalate to once blocked. */
export const canEscalate = (level: PunishmentLevel): boolean => !isBlocked(level);

/** Forgiveness is total: the counter goes to zero, not down by one. */
export const forgive = (): PunishmentLevel => MIN_PUNISHMENT_LEVEL;

export const canForgive = (level: PunishmentLevel): boolean => level > MIN_PUNISHMENT_LEVEL;

/**
 * Apply the end of a completed game.
 *
 * "After playing a normal game without punishment: reset punishment counter to zero." A player
 * punished *for* that game keeps the level they were given — otherwise the punishment would
 * evaporate the moment it took effect, and "consecutive" would mean nothing (D5).
 *
 * Only completed games count. An abandoned or cancelled session resets nothing.
 */
export const resetIfUnpunished = (
  level: PunishmentLevel,
  wasPunishedThisSession: boolean,
): PunishmentLevel => (wasPunishedThisSession ? level : MIN_PUNISHMENT_LEVEL);
