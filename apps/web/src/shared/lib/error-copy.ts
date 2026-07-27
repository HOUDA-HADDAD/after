import { useCallback } from 'react';
import type { ErrorCode } from '@aftergame/shared';
import { ApiError, NetworkError } from '../api/client.js';
import { useT } from '../i18n/LocaleProvider.js';
import type { TranslationKey } from '../i18n/translations.js';

/** The codes with copy of their own. Anything else falls back to a generic failure. */
const KNOWN = new Set<ErrorCode>([
  'VALIDATION_FAILED',
  'EMPTY_CONTENT',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'MEMBER_GAME_BLOCKED',
  'NOT_FOUND',
  'SESSION_GONE',
  'EMAIL_TAKEN',
  'USERNAME_TAKEN',
  'SESSION_ALREADY_ACTIVE',
  'SESSION_PHASE_INVALID',
  'SESSION_TOO_FEW_PLAYERS',
  'SESSION_ROSTER_LOCKED',
  'ALREADY_SUBMITTED',
  'INVITE_UNUSABLE',
  'RATE_LIMITED',
  'INTERNAL',
]);

/**
 * Error code to translation key.
 *
 * One place to decide which words a reader gets, keyed by the stable code the API sends. The
 * client never matches on English prose: the server can reword a title and a translator can
 * reword the French, and neither breaks the other.
 *
 * Pure and hook-free, so it works in a class component or a test as readily as in a screen.
 */
export function errorKeyFor(error: unknown): TranslationKey {
  if (error instanceof NetworkError) return 'error.NETWORK';

  if (error instanceof ApiError && KNOWN.has(error.code)) {
    return `error.${error.code}` as TranslationKey;
  }

  // A code the server added and the client has not caught up with reads as a generic failure —
  // never as the key itself, rendered at somebody.
  return 'error.FALLBACK';
}

/** The message for a failure, in the reader's language. */
export function useErrorMessage(): (error: unknown) => string {
  const t = useT();

  return useCallback((error: unknown) => t(errorKeyFor(error)), [t]);
}

/** Field-level messages from a validation failure, keyed by field name. */
export function fieldErrorsFor(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};

  return Object.fromEntries(
    Object.entries(error.fieldErrors).map(([field, messages]) => [field, messages[0] ?? '']),
  );
}
