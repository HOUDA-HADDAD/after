import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@aftergame/config';
import { buildApp } from '../dist/app.js';
import { seedThemes } from '../prisma/seed.js';
import { startTestDatabase, type TestDatabase } from '../tests/helpers/test-database.js';

/**
 * The stack the browser suite drives.
 *
 * One process, one origin: the **built** API serving the **built** client, against a real
 * PostgreSQL with the real migrations and the real seed. That is the production topology
 * (docs/09-deployment.md), which is the point — a browser suite pointed at a dev server proves
 * the dev server works.
 *
 * Two deliberate differences from production, both stated rather than hidden:
 *
 *   - `NODE_ENV=development` with `SERVE_STATIC=true`. Production insists on an https origin, and
 *     TLS is terminated by the proxy in front rather than by this process, so a browser suite over
 *     plain http cannot run in production mode. The consequences — the `__Host-` cookie prefix,
 *     `Secure`, and HSTS — are asserted directly in the header integration tests instead.
 *   - Rate limiting off. Three players registering and playing inside a minute is not a pattern
 *     the limits are meant to allow, and a suite that trips them tests the limiter rather than the
 *     game. The limiter has its own tests.
 */

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.E2E_PORT ?? 3100);

const prismaCli = (): string =>
  resolve(dirname(createRequire(import.meta.url).resolve('prisma/package.json')), 'build/index.js');

let database: TestDatabase | undefined;

async function main(): Promise<void> {
  database = await startTestDatabase();

  execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: database.url },
    stdio: 'inherit',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: database.url } } });
  await seedThemes(prisma);

  const env = loadEnv({
    NODE_ENV: 'development',
    PORT: String(port),
    HOST: '127.0.0.1',
    APP_ORIGIN: `http://127.0.0.1:${String(port)}`,
    DATABASE_URL: database.url,
    SESSION_SECRET: 'e2e-session-secret-at-least-32-characters',
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
    // Cheap hashing: the suite is about the game, not about how long argon2 takes.
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_TIME_COST: '1',
    SERVE_STATIC: 'true',
    WEB_DIST_PATH: resolve(apiRoot, '../web/dist'),
    // A one-hour grace window, so a purge can be provoked without waiting a day.
    SESSION_GRACE_HOURS: '1',
  });

  const app = await buildApp({ env, prismaClient: prisma });

  await app.listen({ port, host: '127.0.0.1' });

  const stop = async (): Promise<void> => {
    await app.close();
    await prisma.$disconnect();
    await database?.stop();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void stop());
  }

  console.warn(`[e2e] listening on http://127.0.0.1:${String(port)} (postgres: ${database.kind})`);
}

main().catch(async (error: unknown) => {
  console.error('[e2e] failed to start', error);
  await database?.stop();
  process.exit(1);
});
