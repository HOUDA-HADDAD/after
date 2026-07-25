import { ERROR_CODES, NotFoundError } from '@aftergame/shared';
import type { Actor } from '../../lib/authorize.js';
import type { GroupsRepository } from './groups.repository.js';

/**
 * Resolve the caller's standing in a group, or 404.
 *
 * **404, never 403.** A 403 would confirm that a group with this id exists, which is exactly what
 * an outsider probing ids wants to learn. Groups are private with no discovery surface
 * (docs/07-security.md, Authorization) — to a non-member they are indistinguishable from
 * nonexistent.
 *
 * Every group route starts here, so "am I allowed to see this at all?" is answered once, in one
 * place, before any action-specific rule runs.
 */
export async function requireActor(
  groups: GroupsRepository,
  groupId: string,
  userId: string,
): Promise<Actor> {
  const membership = await groups.findMembership(groupId, userId);

  if (membership === null) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such group.');
  }

  return { userId, role: membership.role, status: membership.status };
}
