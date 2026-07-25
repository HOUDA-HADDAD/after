import {
  AppError,
  ConflictError,
  ERROR_CODES,
  normaliseInviteCode,
  type GroupSummaryDto,
  type InvitationDto,
} from '@aftergame/shared';
import type { Env } from '@aftergame/config';
import type { Invitation } from '@prisma/client';
import { assertCan } from '../../lib/authorize.js';
import { generateInviteCode } from '../../lib/invite-code.js';
import { isUniqueViolation } from '../../lib/db.js';
import type { TransactionRunner } from '../../plugins/prisma.js';
import { requireActor } from '../groups/group-access.js';
import { createGroupsRepository, type GroupsRepository } from '../groups/groups.repository.js';
import {
  createInvitationsRepository,
  type InvitationsRepository,
} from './invitations.repository.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** How many times to retry on the astronomically unlikely code collision. */
const CODE_GENERATION_ATTEMPTS = 5;

export interface InvitationsServiceDeps {
  invitations: InvitationsRepository;
  groups: GroupsRepository;
  transaction: TransactionRunner;
  env: Env;
  now?: () => Date;
}

export interface CreateInvitationOptions {
  expiresInHours: number | null;
  maxUses: number | null;
}

const toDto = (invitation: Invitation): InvitationDto => ({
  id: invitation.id,
  code: invitation.code,
  expiresAt: invitation.expiresAt?.toISOString() ?? null,
  maxUses: invitation.maxUses,
  useCount: invitation.useCount,
  createdAt: invitation.createdAt.toISOString(),
});

/**
 * One error for every reason a code might not work.
 *
 * No such code, revoked, expired, all used up — an attacker probing codes learns the same thing
 * from each, which is nothing. Distinguishing them would turn the endpoint into a scanner that
 * confirms which codes ever existed.
 */
const unusableCode = (): AppError =>
  new AppError(ERROR_CODES.INVITE_UNUSABLE, 404, 'That code does not work', {
    detail: 'Ask for a new one.',
  });

export function createInvitationsService({
  invitations,
  groups,
  transaction,
  env,
  now = () => new Date(),
}: InvitationsServiceDeps) {
  return {
    async create(
      groupId: string,
      userId: string,
      options: CreateInvitationOptions,
    ): Promise<InvitationDto> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('invitation:create', actor);

      const expiresAt =
        options.expiresInHours === null
          ? null
          : new Date(now().getTime() + options.expiresInHours * MILLISECONDS_PER_HOUR);

      for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
        try {
          const invitation = await invitations.create({
            groupId,
            code: generateInviteCode(),
            createdById: userId,
            expiresAt,
            maxUses: options.maxUses,
          });

          return toDto(invitation);
        } catch (error) {
          // 40 bits of randomness makes this essentially unreachable, but "essentially" is not
          // "never" and the recovery is one more roll of the dice.
          if (!isUniqueViolation(error, 'code')) throw error;
        }
      }

      throw new ConflictError(ERROR_CODES.CONFLICT, 'Could not generate a code. Try again.');
    },

    async list(groupId: string, userId: string): Promise<InvitationDto[]> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('invitation:list', actor);

      return (await invitations.listActive(groupId, now())).map(toDto);
    },

    async revoke(groupId: string, userId: string, invitationId: string): Promise<void> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('invitation:revoke', actor);

      const invitation = await invitations.findById(invitationId);

      // Scoped to this group: an id from another group must not be revocable from here.
      if (invitation === null || invitation.groupId !== groupId) throw unusableCode();

      await invitations.revoke(invitationId, now());
    },

    /**
     * Redeem a code and join the group.
     *
     * Idempotent for someone who is already a member: they simply land in the group, which is
     * what tapping an old link a second time should do.
     */
    async redeem(rawCode: string, userId: string): Promise<GroupSummaryDto> {
      const code = normaliseInviteCode(rawCode);
      const invitation = await invitations.findByCode(code);

      if (invitation === null) throw unusableCode();

      const existing = await groups.findMembership(invitation.groupId, userId);

      if (existing !== null) {
        return this.summaryFor(invitation.groupId, userId);
      }

      if ((await groups.countMembers(invitation.groupId)) >= env.MAX_GROUP_MEMBERS) {
        throw new ConflictError(
          ERROR_CODES.GROUP_FULL,
          'That group is full',
          `Groups can hold up to ${String(env.MAX_GROUP_MEMBERS)} people.`,
        );
      }

      await transaction(async (tx) => {
        const scopedInvitations = createInvitationsRepository(tx);
        const scopedGroups = createGroupsRepository(tx);

        // Claim first: if the invitation turns out to be unusable, no membership is created.
        if (!(await scopedInvitations.claimUse(invitation.id, now()))) {
          throw unusableCode();
        }

        await scopedGroups.addMember(invitation.groupId, userId);
      });

      return this.summaryFor(invitation.groupId, userId);
    },

    /** The joined group, shaped for the client's sidebar. */
    async summaryFor(groupId: string, userId: string): Promise<GroupSummaryDto> {
      const membership = await groups.findMembership(groupId, userId);
      const group = await groups.findByIdForMember(groupId, userId);

      if (membership === null || group === null) throw unusableCode();

      return {
        id: group.id,
        name: group.name,
        memberCount: await groups.countMembers(groupId),
        viewerRole: membership.role,
        createdAt: group.createdAt.toISOString(),
      };
    },
  };
}

export type InvitationsService = ReturnType<typeof createInvitationsService>;
