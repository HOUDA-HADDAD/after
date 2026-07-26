/**
 * Limits and rules from the specification, in one place.
 *
 * These are imported by the client (to disable a submit button), by the API (Zod schemas), and
 * by the domain (guards) — so a limit can never mean two different things in two layers.
 * See docs/00-spec-decisions.md.
 */

/** Maximum length of a game text or an answer. Spec: "maximum 1000 characters". */
export const TEXT_MAX_LENGTH = 1000;

/** Comments are shorter than answers by design — they are reactions, not essays. */
export const COMMENT_MAX_LENGTH = 500;

/**
 * The reaction palette (D20).
 *
 * A fixed set rather than free emoji input, for two reasons that both matter. A closed set cannot
 * become a second, unmoderated comment field — nobody can react with a sentence written in
 * regional indicators. And a small palette keeps the tally readable: six counts under an answer
 * is a glance, forty is a wall.
 */
export const REACTIONS = ['😂', '😮', '❤️', '😬', '👏', '🤔'] as const;

export type ReactionEmoji = (typeof REACTIONS)[number];

export const isReactionEmoji = (value: string): value is ReactionEmoji =>
  (REACTIONS as readonly string[]).includes(value);

/** Group-written theme copy bounds. Long enough to be useful, short enough to fit a card. */
export const THEME_NAME_MAX_LENGTH = 40;
export const THEME_TEXT_MAX_LENGTH = 160;

/** Spec: "Minimum players: 2." */
export const MIN_PLAYERS_PER_SESSION = 2;

/**
 * Punishment levels and the answer loads they imply live in `@aftergame/game-core`, which owns
 * the rules rather than merely naming them. Import `demandFor`, `escalate`, `isBlocked` and
 * friends from there — two copies of "level 3 means blocked" is one copy too many.
 */

/** Group name bounds. */
export const GROUP_NAME_MIN_LENGTH = 2;
export const GROUP_NAME_MAX_LENGTH = 60;

/** Username bounds and shape. Usernames are the only identifier ever shown to other players. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** Passwords: length over composition rules, per current NIST guidance. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Invitation codes: Crockford base32 minus I, L, O and U, so a code read aloud at a party is
 * unambiguous. 8 characters ≈ 40 bits, which with rate limiting makes enumeration impractical.
 */
export const INVITE_CODE_LENGTH = 8;
export const INVITE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Session cookie name. The `__Host-` prefix is only honoured with Secure + Path=/ + no Domain. */
export const SESSION_COOKIE_NAME = '__Host-aftergame_session';
/** Browsers reject `__Host-` cookies over plain http, so development uses an unprefixed name. */
export const SESSION_COOKIE_NAME_INSECURE = 'aftergame_session';
