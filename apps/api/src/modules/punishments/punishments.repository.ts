import type { PunishmentEvent } from '@prisma/client';
import type { DbClient } from '../../lib/db.js';

export type PunishmentEventWithNames = PunishmentEvent & {
  targetUser: { id: string; username: string };
  actorUser: { id: string; username: string } | null;
};

export interface RecordEventInput {
  groupId: string;
  targetUserId: string;
  actorUserId: string;
  action: 'PUNISH' | 'FORGIVE' | 'AUTO_RESET';
  resultingLevel: number;
  gameSessionId?: string | null;
  reason?: string | null;
}

export const createPunishmentsRepository = (db: DbClient) => ({
  /**
   * Move a membership's counter, but only if it still holds the value we based the decision on.
   *
   * Optimistic concurrency: two hosts pressing "punish" at the same moment would otherwise both
   * read level 1 and both write level 2, losing one punishment. The `consecutivePunishments`
   * condition makes the second write affect zero rows, and the caller reports a conflict rather
   * than silently swallowing it.
   */
  async compareAndSetLevel(
    groupId: string,
    userId: string,
    expectedLevel: number,
    nextLevel: number,
    nextStatus: 'ACTIVE' | 'GAME_BLOCKED',
  ): Promise<boolean> {
    const { count } = await db.groupMembership.updateMany({
      where: { groupId, userId, consecutivePunishments: expectedLevel },
      data: { consecutivePunishments: nextLevel, status: nextStatus },
    });

    return count === 1;
  },

  /** The audit row. Written in the same transaction as the counter move, never after it. */
  async recordEvent(input: RecordEventInput): Promise<PunishmentEvent> {
    return db.punishmentEvent.create({
      data: {
        groupId: input.groupId,
        targetUserId: input.targetUserId,
        actorUserId: input.actorUserId,
        action: input.action,
        resultingLevel: input.resultingLevel,
        gameSessionId: input.gameSessionId ?? null,
        reason: input.reason ?? null,
      },
    });
  },

  /** Newest first. Bounded because a busy group accumulates these for the life of the group. */
  async listForGroup(groupId: string, limit: number): Promise<PunishmentEventWithNames[]> {
    return db.punishmentEvent.findMany({
      where: { groupId },
      include: {
        targetUser: { select: { id: true, username: true } },
        actorUser: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
});

export type PunishmentsRepository = ReturnType<typeof createPunishmentsRepository>;
