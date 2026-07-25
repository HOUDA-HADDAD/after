import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '../constants.js';

/**
 * The client validates with these exact schemas, so it can never build a request the server
 * disagrees with — one definition of "a valid password", used by both sides.
 */

/**
 * A short denylist of passwords that appear at the top of every breach corpus.
 *
 * Not a substitute for a real strength check; it exists to stop the handful of passwords that
 * would be guessed within seconds. Length is the primary defence, per current NIST guidance —
 * composition rules (one upper, one digit, one symbol) push people toward `Password1!` and are
 * deliberately absent.
 */
const COMMON_PASSWORDS = new Set([
  '0123456789',
  '1234567890',
  '12345678910',
  'password12',
  'password123',
  'password1234',
  'qwertyuiop',
  'qwerty12345',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'admin12345',
  'aftergame1',
  'aftergame123',
]);

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, `Usernames need at least ${String(USERNAME_MIN_LENGTH)} characters`)
  .max(USERNAME_MAX_LENGTH, `Usernames can be at most ${String(USERNAME_MAX_LENGTH)} characters`)
  .regex(USERNAME_PATTERN, 'Use letters, numbers, and . _ - only');

/**
 * Emails are stored in a `citext` column, so uniqueness is already case-insensitive. We trim but
 * deliberately do not lowercase: the local part of an address is case-sensitive per RFC 5321, and
 * rewriting what someone typed is not ours to do.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254, 'That email address is too long')
  .email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .max(PASSWORD_MAX_LENGTH, 'That password is too long')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'That password is too common — pick something less guessable',
  );

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Login deliberately does *not* reuse `passwordSchema`.
 *
 * Applying the strength rules here would reject an old password that no longer meets current
 * policy with a validation error, telling an attacker their guess was well-formed but too weak —
 * and locking out a legitimate user who simply needs to sign in. Login checks presence only; the
 * credential check is the authority.
 */
export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').max(254),
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
