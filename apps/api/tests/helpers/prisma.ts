import { PrismaClient } from '@prisma/client';
import { inject } from 'vitest';

let client: PrismaClient | undefined;

/** One client per worker, pointed at the database the global setup started. */
export function testPrisma(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

/**
 * Tables that must survive a reset: the migration ledger, and nothing else.
 *
 * Everything the tests create is disposable by design — which is also true of the production
 * data model, where a finished game is deleted outright (docs/00-spec-decisions.md D11).
 */
const PRESERVED_TABLES = new Set(['_prisma_migrations']);

/**
 * Empty every table between tests.
 *
 * TRUNCATE … CASCADE rather than per-test transaction rollback: the application code under test
 * opens its own transactions, and wrapping those in an outer transaction changes the very
 * isolation behaviour the session tests exist to verify.
 */
export async function resetDatabase(prisma: PrismaClient = testPrisma()): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  const tables = rows
    .map((row) => row.tablename)
    .filter((name) => !PRESERVED_TABLES.has(name))
    .map((name) => `"public"."${name}"`);

  if (tables.length === 0) return;

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
