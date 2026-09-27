import { z } from './zod.js';
import {
  GROUP_NAME_MAX_LENGTH,
  GROUP_NAME_MIN_LENGTH,
  INVITE_CODE_ALPHABET,
  THEME_NAME_MAX_LENGTH,
  THEME_TEXT_MAX_LENGTH,
  INVITE_CODE_LENGTH,
} from '../constants.js';

export const groupNameSchema = z
  .string()
  .trim()
  .min(GROUP_NAME_MIN_LENGTH, 'Donnez un nom au salon')
  .max(GROUP_NAME_MAX_LENGTH, `Ne dépassez pas ${String(GROUP_NAME_MAX_LENGTH)} caractères`);

export const createGroupSchema = z.object({ name: groupNameSchema });
export const renameGroupSchema = z.object({ name: groupNameSchema });

/**
 * Room codes get read aloud at parties and typed by someone who half-heard them.
 *
 * Crockford base32 excludes I, L, O and U precisely because they are misheard and mistyped, and
 * its decoding rules say to accept them anyway and fold them onto the character they resemble.
 * Doing that here turns "is that an oh or a zero?" from a failed join into a non-event.
 */
export const normaliseInviteCode = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[ILil]/g, '1')
    .replace(/[Oo]/g, '0')
    .replace(/[Uu]/g, 'V');

const inviteCodePattern = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${String(INVITE_CODE_LENGTH)}}$`);

export const inviteCodeSchema = z
  .string()
  .transform(normaliseInviteCode)
  .refine((code) => inviteCodePattern.test(code), 'Ce code semble incorrect');

export const joinByCodeSchema = z.object({ code: inviteCodeSchema });

export const createInvitationSchema = z.object({
  /** null means it never expires. */
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .nullable()
    .default(null),
  /** null means unlimited uses. */
  maxUses: z.number().int().min(1).max(1000).nullable().default(null),
});

/**
 * A theme a group writes for itself (D19).
 *
 * Every prompt is required and none may be blank, because a theme with an empty write prompt is a
 * game nobody can start — and the failure would land on the players, not on whoever wrote it. The
 * database enforces the same thing, so a bug here cannot store one either.
 */
export const groupThemeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Donnez un nom au thème')
    .max(
      THEME_NAME_MAX_LENGTH,
      `Le nom ne doit pas dépasser ${String(THEME_NAME_MAX_LENGTH)} caractères`,
    ),
  description: z.string().trim().min(1, 'Décrivez ce thème').max(THEME_TEXT_MAX_LENGTH),
  writePrompt: z
    .string()
    .trim()
    .min(1, 'Indiquez aux joueurs ce qu’ils doivent écrire')
    .max(THEME_TEXT_MAX_LENGTH),
  writePlaceholder: z.string().trim().max(THEME_TEXT_MAX_LENGTH).default(''),
  answerPrompt: z
    .string()
    .trim()
    .min(1, 'Indiquez aux joueurs ce qu’ils doivent répondre')
    .max(THEME_TEXT_MAX_LENGTH),
  /** One emoji, shown in the picker and pinned in the banner all game. */
  icon: z.string().trim().min(1, 'Choisissez une icône').max(8),
  supportsComments: z.boolean().default(true),
  supportsAuthorGuess: z.boolean().default(true),
});

export const memberRoleSchema = z.enum(['COHOST', 'MEMBER']);
export const changeRoleSchema = z.object({ role: memberRoleSchema });

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type RenameGroupInput = z.infer<typeof renameGroupSchema>;
export type JoinByCodeInput = z.infer<typeof joinByCodeSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export type GroupThemeInput = z.infer<typeof groupThemeSchema>;
