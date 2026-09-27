import { z } from './zod.js';
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
  .min(
    USERNAME_MIN_LENGTH,
    `Le pseudonyme doit contenir au moins ${String(USERNAME_MIN_LENGTH)} caractères`,
  )
  .max(
    USERNAME_MAX_LENGTH,
    `Le pseudonyme ne doit pas dépasser ${String(USERNAME_MAX_LENGTH)} caractères`,
  )
  .regex(USERNAME_PATTERN, 'Utilisez uniquement des lettres, des chiffres et les caractères . _ -');

/**
 * Emails are stored in a `citext` column, so uniqueness is already case-insensitive. We trim but
 * deliberately do not lowercase: the local part of an address is case-sensitive per RFC 5321, and
 * rewriting what someone typed is not ours to do.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254, 'Cette adresse e-mail est trop longue')
  .email('Saisissez une adresse e-mail valide');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Utilisez au moins ${String(PASSWORD_MIN_LENGTH)} caractères`)
  .max(PASSWORD_MAX_LENGTH, 'Ce mot de passe est trop long')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'Ce mot de passe est trop courant. Choisissez-en un plus difficile à deviner.',
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
  email: z.string().trim().min(1, 'Saisissez votre adresse e-mail').max(254),
  password: z.string().min(1, 'Saisissez votre mot de passe').max(PASSWORD_MAX_LENGTH),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
