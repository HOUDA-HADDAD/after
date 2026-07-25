import type { GroupMemberDto, GroupSummaryDto, GroupDetailDto } from '@aftergame/shared';
import type { GroupWithCount, MembershipWithUser } from './groups.repository.js';
import type { Group, GroupMembership } from '@prisma/client';

export const toMemberDto = (membership: MembershipWithUser): GroupMemberDto => ({
  userId: membership.user.id,
  username: membership.user.username,
  role: membership.role,
  status: membership.status,
  // Public within the group by design: it is a rule of the game, and the lobby's answer-load
  // preview is inexplicable without it. It is per-group, so it says nothing about the person
  // anywhere else.
  consecutivePunishments: membership.consecutivePunishments,
  joinedAt: membership.joinedAt.toISOString(),
});

export const toGroupSummaryDto = (
  group: GroupWithCount,
  viewerMembership: GroupMembership,
): GroupSummaryDto => ({
  id: group.id,
  name: group.name,
  memberCount: group._count.memberships,
  viewerRole: viewerMembership.role,
  createdAt: group.createdAt.toISOString(),
});

export const toGroupDetailDto = (
  group: Group,
  members: MembershipWithUser[],
  viewerRole: GroupMemberDto['role'],
): GroupDetailDto => ({
  id: group.id,
  name: group.name,
  memberCount: members.length,
  viewerRole,
  createdAt: group.createdAt.toISOString(),
  members: members.map(toMemberDto),
});

export const memberJsonSchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    username: { type: 'string' },
    role: { type: 'string' },
    status: { type: 'string' },
    consecutivePunishments: { type: 'integer' },
    joinedAt: { type: 'string' },
  },
  required: ['userId', 'username', 'role', 'status', 'consecutivePunishments', 'joinedAt'],
  additionalProperties: false,
} as const;

const summaryProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  memberCount: { type: 'integer' },
  viewerRole: { type: 'string' },
  createdAt: { type: 'string' },
} as const;

export const groupSummaryJsonSchema = {
  type: 'object',
  properties: summaryProperties,
  required: ['id', 'name', 'memberCount', 'viewerRole', 'createdAt'],
  additionalProperties: false,
} as const;

export const groupListJsonSchema = {
  type: 'object',
  properties: { groups: { type: 'array', items: groupSummaryJsonSchema } },
  required: ['groups'],
  additionalProperties: false,
} as const;

export const groupDetailJsonSchema = {
  type: 'object',
  properties: {
    ...summaryProperties,
    members: { type: 'array', items: memberJsonSchema },
  },
  required: ['id', 'name', 'memberCount', 'viewerRole', 'createdAt', 'members'],
  additionalProperties: false,
} as const;

export const memberListJsonSchema = {
  type: 'object',
  properties: { members: { type: 'array', items: memberJsonSchema } },
  required: ['members'],
  additionalProperties: false,
} as const;
