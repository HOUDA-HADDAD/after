import {
  ConflictError,
  ERROR_CODES,
  ForbiddenError,
  NotFoundError,
  type GroupMemberDto,
} from '@aftergame/shared';
import { assertCan, type Target } from '../../lib/authorize.js';
import type { TransactionRunner } from '../../plugins/prisma.js';
import { requireActor } from '../groups/group-access.js';
import { toMemberDto } from '../groups/groups.mapper.js';
import { createGroupsRepository, type GroupsRepository } from '../groups/groups.repository.js';

export interface MembershipsServiceDeps {
  groups: GroupsRepository;
  transaction: TransactionRunner;
}

export function createMembershipsService({ groups, transaction }: MembershipsServiceDeps) {
  /** Look up the person being acted on. 404 if they are not in this group. */
  const requireTarget = async (groupId: string, targetUserId: string): Promise<Target> => {
    const membership = await groups.findMembership(groupId, targetUserId);

    if (membership === null) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'That person is not in this group.');
    }

    return { userId: targetUserId, role: membership.role };
  };

  return {
    async list(groupId: string, userId: string): Promise<GroupMemberDto[]> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('member:list', actor);

      return (await groups.listMembers(groupId)).map(toMemberDto);
    },

    /**
     * Promote a member to co-host, or demote a co-host back to member. Owner only.
     *
     * The owner's own role is not reachable from here — changing it is `transferOwnership`, which
     * is a different thing with different consequences.
     */
    async changeRole(
      groupId: string,
      actorId: string,
      targetUserId: string,
      role: 'COHOST' | 'MEMBER',
    ): Promise<GroupMemberDto> {
      const actor = await requireActor(groups, groupId, actorId);
      const target = await requireTarget(groupId, targetUserId);

      assertCan(role === 'COHOST' ? 'member:promote' : 'member:demote', actor, target);

      if (target.userId === actor.userId) {
        throw new ForbiddenError(
          ERROR_CODES.CANNOT_ACT_ON_SELF,
          'You cannot change your own role.',
        );
      }

      if (target.role === 'OWNER') {
        throw new ConflictError(
          ERROR_CODES.CONFLICT,
          'The owner’s role cannot be changed',
          'Transfer ownership instead.',
        );
      }

      await groups.setRole(groupId, targetUserId, role);

      const members = await groups.listMembers(groupId);
      const updated = members.find((member) => member.userId === targetUserId);

      if (updated === undefined) throw new NotFoundError();

      return toMemberDto(updated);
    },

    /** Remove someone else. Co-hosts may remove ordinary members only (D16). */
    async remove(groupId: string, actorId: string, targetUserId: string): Promise<void> {
      const actor = await requireActor(groups, groupId, actorId);
      const target = await requireTarget(groupId, targetUserId);

      assertCan('member:remove', actor, target);

      await groups.removeMember(groupId, targetUserId);
    },

    /** Leave a group of your own accord. The owner must transfer ownership first. */
    async leave(groupId: string, userId: string): Promise<void> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('member:leave', actor);

      await groups.removeMember(groupId, userId);
    },

    /**
     * Hand the group to someone else.
     *
     * The previous owner stays on as a co-host rather than being demoted to member — they were
     * running the group a moment ago, and dropping them to the bottom would be a surprise.
     *
     * Order inside the transaction is not cosmetic: a partial unique index permits exactly one
     * OWNER per group, so the current owner must be demoted *before* the new one is promoted.
     */
    async transferOwnership(
      groupId: string,
      actorId: string,
      targetUserId: string,
    ): Promise<GroupMemberDto[]> {
      const actor = await requireActor(groups, groupId, actorId);
      const target = await requireTarget(groupId, targetUserId);

      assertCan('ownership:transfer', actor);

      if (target.userId === actor.userId) {
        throw new ForbiddenError(ERROR_CODES.CANNOT_ACT_ON_SELF, 'You already own this group.');
      }

      await transaction(async (tx) => {
        const scoped = createGroupsRepository(tx);

        await scoped.setRole(groupId, actorId, 'COHOST');
        await scoped.setRole(groupId, targetUserId, 'OWNER');
        await scoped.setOwner(groupId, targetUserId);
      });

      return (await groups.listMembers(groupId)).map(toMemberDto);
    },
  };
}

export type MembershipsService = ReturnType<typeof createMembershipsService>;
