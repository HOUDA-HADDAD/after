import { z } from 'zod';
import {
  GROUP_NAME_MAX_LENGTH,
  GROUP_NAME_MIN_LENGTH,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
} from '../constants.js';

export const groupNameSchema = z
  .string()
  .trim()
  .min(GROUP_NAME_MIN_LENGTH, 'Give the group a name')
  .max(GROUP_NAME_MAX_LENGTH, `Keep it under ${String(GROUP_NAME_MAX_LENGTH)} characters`);

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
  .refine((code) => inviteCodePattern.test(code), 'That code does not look right');

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

export const memberRoleSchema = z.enum(['COHOST', 'MEMBER']);
export const changeRoleSchema = z.object({ role: memberRoleSchema });

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type RenameGroupInput = z.infer<typeof renameGroupSchema>;
export type JoinByCodeInput = z.infer<typeof joinByCodeSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
