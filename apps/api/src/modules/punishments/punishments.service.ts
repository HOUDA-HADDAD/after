import { ConflictError, ERROR_CODES, NotFoundError, type GroupMemberDto } from '@aftergame/shared';
import {
  canEscalate,
  escalate,
  forgive,
  isPunishmentLevel,
  statusFor,
  type PunishmentLevel,
} from '@aftergame/game-core';
import { assertCan, type Target } from '../../lib/authorize.js';
import type { TransactionRunner } from '../../plugins/prisma.js';
import { requireActor } from '../groups/group-access.js';
import { toMemberDto } from '../groups/groups.mapper.js';
import type { GroupsRepository } from '../groups/groups.repository.js';
import {
  createPunishmentsRepository,
  type PunishmentsRepository,
} from './punishments.repository.js';
import { toPunishmentEventDto, type PunishmentEventDto } from './punishments.mapper.js';

const HISTORY_LIMIT = 100;

export interface PunishmentsServiceDeps {
  punishments: PunishmentsRepository;
  groups: GroupsRepository;
  transaction: TransactionRunner;
}

export function createPunishmentsService({
  punishments,
  groups,
  transaction,
}: PunishmentsServiceDeps) {
  const requireTarget = async (
    groupId: string,
    targetUserId: string,
  ): Promise<{ target: Target; level: PunishmentLevel }> => {
    const membership = await groups.findMembership(groupId, targetUserId);

    if (membership === null) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND, 'That person is not in this group.');
    }

    if (!isPunishmentLevel(membership.consecutivePunishments)) {
      // The database CHECK constraint makes this unreachable; if it ever fires, something has
      // written a level the rules do not recognise and we must not guess what it meant.
      throw new ConflictError(ERROR_CODES.CONFLICT, 'That member’s punishment level is invalid');
    }

    return {
      target: { userId: targetUserId, role: membership.role },
      level: membership.consecutivePunishments,
    };
  };

  /** Reload the roster row so the client gets the member exactly as the group sees them. */
  const memberAfter = async (groupId: string, userId: string): Promise<GroupMemberDto> => {
    const member = (await groups.listMembers(groupId)).find((row) => row.userId === userId);

    if (member === undefined) throw new NotFoundError();

    return toMemberDto(member);
  };

  return {
    /**
     * Raise someone's punishment level by one.
     *
     * The counter move and its audit row are written in **one transaction**: a counter that
     * changed without a record of who changed it would make "three consecutive punishments"
     * something a host could be accused of inventing (docs/03-database-schema.md).
     */
    async punish(
      groupId: string,
      actorId: string,
      targetUserId: string,
      reason?: string,
    ): Promise<GroupMemberDto> {
      const actor = await requireActor(groups, groupId, actorId);
      const { target, level } = await requireTarget(groupId, targetUserId);

      assertCan('punishment:punish', actor, target);

      if (!canEscalate(level)) {
        throw new ConflictError(
          ERROR_CODES.CONFLICT,
          'They are already blocked from games',
          'Forgive them first if you want to start over.',
        );
      }

      const nextLevel = escalate(level);

      await transaction(async (tx) => {
        const scopedPunishments = createPunishmentsRepository(tx);

        const moved = await scopedPunishments.compareAndSetLevel(
          groupId,
          targetUserId,
          level,
          nextLevel,
          statusFor(nextLevel),
        );

        if (!moved) {
          throw new ConflictError(
            ERROR_CODES.CONFLICT,
            'Someone else just changed that member',
            'Try again.',
          );
        }

        await scopedPunishments.recordEvent({
          groupId,
          targetUserId,
          actorUserId: actorId,
          action: 'PUNISH',
          resultingLevel: nextLevel,
          ...(reason === undefined ? {} : { reason }),
        });
      });

      return memberAfter(groupId, targetUserId);
    },

    /**
     * Clear someone's counter entirely.
     *
     * Forgiveness is total rather than a step down — a host who forgives is not reducing a
     * sentence, they are ending it. Forgiving someone with nothing to forgive succeeds quietly
     * and writes no audit row, because a no-op is not an event worth recording.
     */
    async forgive(groupId: string, actorId: string, targetUserId: string): Promise<GroupMemberDto> {
      const actor = await requireActor(groups, groupId, actorId);
      const { target, level } = await requireTarget(groupId, targetUserId);

      assertCan('punishment:forgive', actor, target);

      if (level === 0) return memberAfter(groupId, targetUserId);

      const nextLevel = forgive();

      await transaction(async (tx) => {
        const scopedPunishments = createPunishmentsRepository(tx);

        const moved = await scopedPunishments.compareAndSetLevel(
          groupId,
          targetUserId,
          level,
          nextLevel,
          statusFor(nextLevel),
        );

        if (!moved) {
          throw new ConflictError(
            ERROR_CODES.CONFLICT,
            'Someone else just changed that member',
            'Try again.',
          );
        }

        await scopedPunishments.recordEvent({
          groupId,
          targetUserId,
          actorUserId: actorId,
          action: 'FORGIVE',
          resultingLevel: nextLevel,
        });
      });

      return memberAfter(groupId, targetUserId);
    },

    /** Visible to every member — accountability for hosts, not a private list about people. */
    async history(groupId: string, userId: string): Promise<PunishmentEventDto[]> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('punishment:list', actor);

      return (await punishments.listForGroup(groupId, HISTORY_LIMIT)).map(toPunishmentEventDto);
    },
  };
}

export type PunishmentsService = ReturnType<typeof createPunishmentsService>;
