import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '@aftergame/config';

import requestContext, { generateRequestId } from './plugins/request-context.js';
import readiness from './plugins/readiness.js';
import prisma from './plugins/prisma.js';
import security from './plugins/security.js';
import staticFiles from './plugins/static.js';
import errorHandler from './plugins/error-handler.js';
import healthRoutes from './modules/health/health.routes.js';

/**
 * Fields that must never reach a log line.
 *
 * Anonymity is the product: a log that records who submitted which text defeats it entirely.
 * We log ids, phases, durations and error codes — never content (docs/07-security.md).
 */
const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.body',
  'req.body.text',
  'req.body.answer',
  'req.body.comment',
  '*.password',
  '*.passwordHash',
  '*.token',
];

export interface BuildAppOptions {
  env: Env;
  /**
   * An existing Prisma client to use instead of creating one. Tests inject a shared client so
   * the whole suite holds a single database connection; production always creates its own.
   */
  prismaClient?: PrismaClient;
}

/**
 * Compose the application. Does not listen — that is `main.ts`'s job, which keeps this usable
 * from tests via `app.inject()` with no port and no teardown races.
 */
export async function buildApp({ env, prismaClient }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: generateRequestId,
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 128 * 1024,
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
  });

  await app.register(requestContext);
  await app.register(readiness);
  await app.register(prisma, {
    env,
    ...(prismaClient === undefined ? {} : { client: prismaClient }),
  });
  await app.register(security, { env });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(staticFiles, { env });

  // Must come after `static`, because the not-found handler falls back to index.html.
  await app.register(errorHandler, { env });

  await app.register(healthRoutes);

  // Feature modules register under /api/v1 from Phase 2 onwards.
  await app.register(
    async (api) => {
      api.get('/version', async () => ({ name: 'aftergame', version: '0.1.0' }));
    },
    { prefix: '/api/v1' },
  );

  return app;
}
