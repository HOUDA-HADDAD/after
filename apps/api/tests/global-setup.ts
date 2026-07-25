import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import { startTestDatabase, type TestDatabase } from './helpers/test-database.js';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve Prisma's CLI so it can be spawned with node directly — no shell, no escaping risk. */
const prismaCli = (): string =>
  resolve(dirname(createRequire(import.meta.url).resolve('prisma/package.json')), 'build/index.js');

let database: TestDatabase | undefined;

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    databaseKind: TestDatabase['kind'];
  }
}

/**
 * Start one database for the whole run, migrate it, and hand its URL to the workers.
 *
 * Migrations are applied by `prisma migrate deploy` — the exact command production runs — so the
 * suite verifies the real migration path rather than some test-only schema shortcut.
 */
export async function setup({ provide }: TestProject): Promise<void> {
  database = await startTestDatabase();

  execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: database.url },
    stdio: 'inherit',
  });

  provide('databaseUrl', database.url);
  provide('databaseKind', database.kind);

  console.warn(`[tests] PostgreSQL tier: ${database.kind}`);
}

export async function teardown(): Promise<void> {
  await database?.stop();
}
