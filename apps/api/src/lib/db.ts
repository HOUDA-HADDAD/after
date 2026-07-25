import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Anything a repository can run a query against.
 *
 * Repositories accept this rather than `PrismaClient` so the same method works inside and outside
 * a transaction. That matters more than it sounds: the distribution critical section in Phase 6
 * has to call several repositories inside one `SERIALIZABLE` transaction, and a repository that
 * hardcodes the root client silently escapes it.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;
