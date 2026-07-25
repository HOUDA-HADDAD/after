import type { User } from '@prisma/client';
import type { UserDto } from '@aftergame/shared';

/**
 * Entity to DTO.
 *
 * `passwordHash` is the field that must never leave this process; listing properties explicitly
 * rather than spreading is what guarantees it cannot, even if the entity grows new columns.
 * The route's response schema drops undeclared fields as a second line of defence.
 */
export const toUserDto = (user: User): UserDto => ({
  id: user.id,
  username: user.username,
  email: user.email,
  createdAt: user.createdAt.toISOString(),
});

/** JSON Schema for response serialization — Fastify sends only what is declared here. */
export const userDtoJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    createdAt: { type: 'string' },
  },
  required: ['id', 'username', 'email', 'createdAt'],
  additionalProperties: false,
} as const;

export const sessionDtoJsonSchema = {
  type: 'object',
  properties: { user: userDtoJsonSchema },
  required: ['user'],
  additionalProperties: false,
} as const;
