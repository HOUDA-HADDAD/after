import {
  ERROR_CODES,
  NotFoundError,
  type GroupDetailDto,
  type GroupSummaryDto,
} from '@aftergame/shared';
import type { Env } from '@aftergame/config';
import { assertCan } from '../../lib/authorize.js';
import { requireActor } from './group-access.js';
import { toGroupDetailDto, toGroupSummaryDto } from './groups.mapper.js';
import type { GroupsRepository } from './groups.repository.js';

export interface GroupsServiceDeps {
  groups: GroupsRepository;
  env: Env;
}

export function createGroupsService({ groups, env }: GroupsServiceDeps) {
  return {
    async create(userId: string, name: string): Promise<GroupSummaryDto> {
      const group = await groups.createWithOwner({ name, ownerId: userId });

      return {
        id: group.id,
        name: group.name,
        memberCount: 1,
        viewerRole: 'OWNER',
        createdAt: group.createdAt.toISOString(),
      };
    },

    async listForUser(userId: string): Promise<GroupSummaryDto[]> {
      const memberships = await groups.listForUser(userId);

      return memberships.map((membership) => toGroupSummaryDto(membership.group, membership));
    },

    async detail(groupId: string, userId: string): Promise<GroupDetailDto> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('group:read', actor);

      const group = await groups.findByIdForMember(groupId, userId);
      if (group === null) throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'No such group.');

      const members = await groups.listMembers(groupId);

      return toGroupDetailDto(group, members, actor.role);
    },

    async rename(groupId: string, userId: string, name: string): Promise<GroupSummaryDto> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('group:rename', actor);

      const group = await groups.rename(groupId, name);
      const memberCount = await groups.countMembers(groupId);

      return {
        id: group.id,
        name: group.name,
        memberCount,
        viewerRole: actor.role,
        createdAt: group.createdAt.toISOString(),
      };
    },

    /** Owner only. Cascades to every membership, invitation, punishment record and live session. */
    async remove(groupId: string, userId: string): Promise<void> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('group:delete', actor);

      await groups.delete(groupId);
    },

    /** The cap exists so the roster and the distribution stay sane; see MAX_GROUP_MEMBERS. */
    maxMembers(): number {
      return env.MAX_GROUP_MEMBERS;
    },
  };
}

export type GroupsService = ReturnType<typeof createGroupsService>;
