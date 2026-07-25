import type { ErrorCode } from '@aftergame/shared';
import { ApiError, NetworkError } from '../api/client.js';

/**
 * Error code to human copy.
 *
 * One place to write the words a user reads, keyed by the stable code the API sends. This is also
 * where translations would slot in, which is why no component composes error prose itself.
 */
const COPY: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Please check the highlighted fields.',
  EMPTY_CONTENT: 'Write something first — it cannot be empty.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  FORBIDDEN: 'You do not have permission to do that.',
  MEMBER_GAME_BLOCKED: 'You cannot join games in this group until a host forgives you.',
  NOT_FOUND: 'We could not find that.',
  SESSION_GONE: 'That game has ended and been deleted.',
  EMAIL_TAKEN: 'That email already has an account. Try signing in instead.',
  USERNAME_TAKEN: 'That username is taken. Pick another one.',
  SESSION_ALREADY_ACTIVE: 'A game is already running in this group.',
  SESSION_PHASE_INVALID: 'The game has already moved on.',
  SESSION_TOO_FEW_PLAYERS: 'You need at least two players to start.',
  SESSION_ROSTER_LOCKED: 'This game has already started.',
  ALREADY_SUBMITTED: 'You have already submitted that.',
  INVITE_UNUSABLE: 'That code does not work. Ask for a new one.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
};

const FALLBACK = 'Something went wrong. Please try again.';

export function messageFor(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'Could not reach the server. Check your connection and try again.';
  }

  if (error instanceof ApiError) return COPY[error.code] ?? FALLBACK;

  return FALLBACK;
}

/** Field-level messages from a validation failure, keyed by field name. */
export function fieldErrorsFor(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};

  return Object.fromEntries(
    Object.entries(error.fieldErrors).map(([field, messages]) => [field, messages[0] ?? '']),
  );
}
