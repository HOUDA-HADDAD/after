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

/**
 * Was this a unique-constraint violation, optionally on a specific column?
 *
 * Checking availability before inserting is a race — two registrations for the same email can
 * both pass the check — so the insert has to be able to fail gracefully as well. Duck-typed
 * rather than `instanceof PrismaClientKnownRequestError` so this stays a type-only dependency on
 * Prisma and can live outside a repository.
 */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  if (column === undefined) return true;

  const target = meta?.target;
  return Array.isArray(target) && target.includes(column);
}
