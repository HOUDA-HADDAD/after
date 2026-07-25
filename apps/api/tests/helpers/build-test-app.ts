import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { loadEnv, type Env } from '@aftergame/config';
import { buildApp } from '../../src/app.js';
import { testPrisma } from './prisma.js';

/**
 * A test app with rate limiting off and logs silenced, so assertions are about behaviour rather
 * than about how fast the suite happens to run.
 */
export interface TestAppOptions {
  env?: Partial<NodeJS.ProcessEnv>;
  /**
   * Register extra routes before `ready()`. Fastify locks its route table at that point, so a
   * route added afterwards silently 404s — which is exactly the trap this option exists to avoid.
   */
  routes?: (app: FastifyInstance) => void | Promise<void>;
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<{
  app: FastifyInstance;
  env: Env;
}> {
  const { env: overrides = {}, routes } = options;

  const config = loadEnv({
    NODE_ENV: 'test',
    // The real database the global setup started, so readiness and repositories exercise it.
    DATABASE_URL: inject('databaseUrl'),
    SESSION_SECRET: 'test-secret-that-is-at-least-32-chars',
    APP_ORIGIN: 'http://localhost:5173',
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    // The cheapest parameters the schema allows. These tests are about auth behaviour, not about
    // how long argon2 takes; production parameters are asserted in src/lib/password.test.ts.
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_TIME_COST: '1',
    ...overrides,
  });

  // One shared client for the whole suite: the PGlite fallback serves a single connection.
  const app = await buildApp({ env: config, prismaClient: testPrisma() });
  if (routes) await routes(app);

  return { app, env: config };
}
