import type { Invitation } from '@prisma/client';
import type { DbClient } from '../../lib/db.js';

export interface CreateInvitationInput {
  groupId: string;
  code: string;
  createdById: string;
  expiresAt: Date | null;
  maxUses: number | null;
}

export const createInvitationsRepository = (db: DbClient) => ({
  async create(input: CreateInvitationInput): Promise<Invitation> {
    return db.invitation.create({
      data: {
        groupId: input.groupId,
        code: input.code,
        createdById: input.createdById,
        expiresAt: input.expiresAt,
        maxUses: input.maxUses,
      },
    });
  },

  async findByCode(code: string): Promise<Invitation | null> {
    return db.invitation.findUnique({ where: { code } });
  },

  async findById(id: string): Promise<Invitation | null> {
    return db.invitation.findUnique({ where: { id } });
  },

  /** Live invitations for a group: newest first, revoked ones excluded. */
  async listActive(groupId: string, now: Date): Promise<Invitation[]> {
    return db.invitation.findMany({
      where: {
        groupId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async revoke(id: string, now: Date): Promise<void> {
    await db.invitation.update({ where: { id }, data: { revokedAt: now } });
  },

  /**
   * Claim one use, atomically.
   *
   * A conditional update rather than read-then-write: two people redeeming the last remaining use
   * at the same moment would both pass a prior check, and both get in. Every condition — revoked,
   * expired, exhausted — is evaluated by the database in the same statement that increments.
   *
   * Raw SQL because the exhaustion test compares two columns (`use_count < max_uses`), which
   * Prisma's query builder cannot express. Parameterised via the tagged template, so nothing here
   * is string concatenation.
   *
   * Returns false when the invitation was unusable, which the caller reports exactly as it
   * reports a bad code.
   */
  async claimUse(id: string, now: Date): Promise<boolean> {
    const updated = await db.$executeRaw`
      UPDATE "invitations"
         SET "use_count" = "use_count" + 1
       WHERE "id" = ${id}::uuid
         AND "revoked_at" IS NULL
         AND ("expires_at" IS NULL OR "expires_at" > ${now})
         AND ("max_uses" IS NULL OR "use_count" < "max_uses")
    `;

    return updated === 1;
  },
});

export type InvitationsRepository = ReturnType<typeof createInvitationsRepository>;
