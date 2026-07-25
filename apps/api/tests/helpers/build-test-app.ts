import type { FastifyInstance } from 'fastify';
import { loadEnv, type Env } from '@aftergame/config';
import { buildApp } from '../../src/app.js';

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
    DATABASE_URL: 'postgresql://test:test@localhost:5432/aftergame_test',
    SESSION_SECRET: 'test-secret-that-is-at-least-32-chars',
    APP_ORIGIN: 'http://localhost:5173',
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    ...overrides,
  });

  const app = await buildApp({ env: config });
  if (routes) await routes(app);

  return { app, env: config };
}
