import { z } from 'zod';
import { COMMENT_MAX_LENGTH, TEXT_MAX_LENGTH } from '../constants.js';

/**
 * Written content — texts and answers alike.
 *
 * "Empty texts are forbidden" is enforced in three places on purpose: here for a good error
 * message, in the service for the rule, and by a `CHECK` constraint that no bug can bypass. The
 * trim is what makes a body of spaces fail rather than pass.
 */
export const contentBodySchema = z
  .string()
  .trim()
  .min(1, 'Write something first — it cannot be empty')
  .max(TEXT_MAX_LENGTH, `Keep it under ${String(TEXT_MAX_LENGTH)} characters`);

/** A draft may be empty — that is the difference between saving and submitting. */
export const draftBodySchema = z.string().max(TEXT_MAX_LENGTH);

export const createSessionSchema = z.object({
  themeId: z.string().uuid('Pick a theme'),
});

export const saveDraftSchema = z.object({ body: draftBodySchema });
export const submitContentSchema = z.object({ body: contentBodySchema });

export const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first')
    .max(COMMENT_MAX_LENGTH, `Keep it under ${String(COMMENT_MAX_LENGTH)} characters`),
  /** Chosen per comment, at post time. Anonymous is the default and is never reversible (D17). */
  isAnonymous: z.boolean().default(true),
});

export const submitGuessSchema = z.object({
  guessedPlayerId: z.string().uuid(),
});

export const revealVoteSchema = z.object({
  choice: z.enum(['YES', 'NO']),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
export type SubmitContentInput = z.infer<typeof submitContentSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type SubmitGuessInput = z.infer<typeof submitGuessSchema>;
export type RevealVoteInput = z.infer<typeof revealVoteSchema>;
