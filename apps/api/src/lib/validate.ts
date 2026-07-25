import { ValidationError } from '@aftergame/shared';
import type { z } from 'zod';

/**
 * Parse a request payload with a shared Zod schema, or raise a typed validation error.
 *
 * Fastify's own JSON Schema validation stays in place for response *serialization* — it is what
 * guarantees an undeclared field cannot be sent — but requests are validated with the same Zod
 * schemas the client uses, so the two can never disagree about what is valid.
 */
export function parseOrThrow<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  payload: unknown,
): TOutput {
  const result = schema.safeParse(payload);

  if (result.success) return result.data;

  const errors: Record<string, string[]> = {};

  for (const issue of result.error.issues) {
    const field = issue.path.join('.') || 'request';
    errors[field] = [...(errors[field] ?? []), issue.message];
  }

  throw new ValidationError(errors);
}
