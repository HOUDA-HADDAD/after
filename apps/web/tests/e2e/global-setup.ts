import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../../../api/tests/helpers/test-database.js';
import { seedThemes } from '../../../api/prisma/seed.js';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../api');

const prismaCli = (): string =>
  resolve(dirname(createRequire(import.meta.url).resolve('prisma/package.json')), 'build/index.js');

let database: TestDatabase | undefined;

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * A real PostgreSQL, the real migrations, and the real seed — for the full-game test.
 *
 * The same two-tier database helper the API suite uses, imported rather than reimplemented. This
 * suite is the one place where the browser layer and the server layer meet, so anything faked
 * here would fake away the only thing it exists to prove.
 */
export async function setup({ provide }: TestProject): Promise<void> {
  database = await startTestDatabase();

  execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: database.url },
    stdio: 'inherit',
  });

  // Themes are data, not code (D15) — a game cannot start without one, so the seed runs here for
  // the same reason it runs in production.
  const prisma = new PrismaClient({ datasources: { db: { url: database.url } } });

  try {
    await seedThemes(prisma);
  } finally {
    await prisma.$disconnect();
  }

  provide('databaseUrl', database.url);
}

export async function teardown(): Promise<void> {
  await database?.stop();
}
