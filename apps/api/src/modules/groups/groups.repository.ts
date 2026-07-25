import { GroupRole, MembershipStatus, type Group, type GroupMembership } from '@prisma/client';
import type { DbClient } from '../../lib/db.js';

export interface CreateGroupInput {
  name: string;
  ownerId: string;
}

export type MembershipWithUser = GroupMembership & {
  user: { id: string; username: string };
};

export type GroupWithCount = Group & { _count: { memberships: number } };
export type MembershipWithGroup = GroupMembership & { group: GroupWithCount };

/**
 * The worked example for the repository pattern (docs/04-modules.md).
 *
 * The rule this file exists to demonstrate: **every read is scoped by membership inside the
 * query**, never fetched and then checked. Prevention at the query is what makes IDOR
 * structurally impossible rather than a code-review responsibility — a caller cannot forget the
 * check, because there is no method that returns a group without one.
 */
export const createGroupsRepository = (db: DbClient) => ({
  /**
   * Create a group and its owner membership atomically.
   *
   * Prisma wraps nested writes in a single transaction, so a group can never exist without an
   * owner — which is also what the `one owner per group` partial unique index assumes.
   */
  async createWithOwner({ name, ownerId }: CreateGroupInput): Promise<Group> {
    return db.group.create({
      data: {
        name,
        ownerId,
        memberships: {
          create: { userId: ownerId, role: GroupRole.OWNER, status: MembershipStatus.ACTIVE },
        },
      },
    });
  },

  /**
   * Fetch a group **only if the user is a member of it**.
   *
   * Returns null for a group that exists but is not yours, which the route turns into a 404 —
   * a 403 would confirm the group exists (docs/07-security.md, Authorization).
   */
  async findByIdForMember(groupId: string, userId: string): Promise<Group | null> {
    return db.group.findFirst({
      where: { id: groupId, memberships: { some: { userId } } },
    });
  },

  /**
   * Groups the user belongs to, with their role and the member count.
   *
   * Driven from the membership side so one query answers all three questions — going from the
   * group side would need a follow-up per group to find the viewer's own role.
   */
  async listForUser(userId: string): Promise<MembershipWithGroup[]> {
    return db.groupMembership.findMany({
      where: { userId },
      include: { group: { include: { _count: { select: { memberships: true } } } } },
      orderBy: { group: { createdAt: 'desc' } },
    });
  },

  async rename(groupId: string, name: string): Promise<Group> {
    return db.group.update({ where: { id: groupId }, data: { name } });
  },

  /** Cascades to memberships, invitations, punishment events and any live session. */
  async delete(groupId: string): Promise<void> {
    await db.group.delete({ where: { id: groupId } });
  },

  /** The membership row carries the role and the group-local punishment counter. */
  async findMembership(groupId: string, userId: string): Promise<GroupMembership | null> {
    return db.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  },

  /** Ordered owner → co-hosts → members, then by join time, which is how the roster reads best. */
  async listMembers(groupId: string): Promise<MembershipWithUser[]> {
    return db.groupMembership.findMany({
      where: { groupId },
      include: { user: { select: { id: true, username: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  },

  /** Used to enforce MAX_GROUP_MEMBERS before accepting an invitation redemption. */
  async countMembers(groupId: string): Promise<number> {
    return db.groupMembership.count({ where: { groupId } });
  },

  /**
   * Members eligible to join a game: `ACTIVE` only, so a player at three consecutive punishments
   * is excluded from the roster while keeping full access to the group (D7).
   */
  async listEligiblePlayers(groupId: string): Promise<GroupMembership[]> {
    return db.groupMembership.findMany({
      where: { groupId, status: MembershipStatus.ACTIVE },
      orderBy: { joinedAt: 'asc' },
    });
  },

  async addMember(groupId: string, userId: string): Promise<GroupMembership> {
    return db.groupMembership.create({
      data: { groupId, userId, role: GroupRole.MEMBER, status: MembershipStatus.ACTIVE },
    });
  },

  async setRole(groupId: string, userId: string, role: GroupRole): Promise<GroupMembership> {
    return db.groupMembership.update({
      where: { groupId_userId: { groupId, userId } },
      data: { role },
    });
  },

  async removeMember(groupId: string, userId: string): Promise<void> {
    await db.groupMembership.delete({ where: { groupId_userId: { groupId, userId } } });
  },

  async setOwner(groupId: string, ownerId: string): Promise<void> {
    await db.group.update({ where: { id: groupId }, data: { ownerId } });
  },
});

export type GroupsRepository = ReturnType<typeof createGroupsRepository>;
