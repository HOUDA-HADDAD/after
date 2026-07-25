import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Env } from '@aftergame/config';

/**
 * Run a unit of work in one transaction.
 *
 * Services own transaction boundaries (docs/01-architecture.md §2) but must not hold the Prisma
 * client — so the boundary is handed to them as a function. This also keeps `$transaction` inside
 * the plugin that owns the client's lifecycle, which is the only place it belongs.
 */
export type TransactionRunner = <T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

/**
 * Run work only if no other instance is already doing it.
 *
 * PostgreSQL advisory locks give job leadership for free — no extra service, no coordination
 * protocol. Running two API instances therefore never double-purges a session or double-sweeps
 * the abandoned ones. Returns false when another holder had it.
 */
export type AdvisoryLockRunner = (key: number, work: () => Promise<void>) => Promise<boolean>;

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    transaction: TransactionRunner;
    withAdvisoryLock: AdvisoryLockRunner;
  }
}

/**
 * Database client lifecycle.
 *
 * The client is created lazily — Prisma opens a connection on first query, not on construction —
 * so building the app never blocks on the database. Readiness is what reports whether the
 * database is actually reachable; liveness deliberately does not, because a slow database should
 * not get the container restarted (docs/09-deployment.md, Operations).
 */
export interface PrismaPluginOptions {
  env: Env;
  /**
   * An existing client to use instead of creating one.
   *
   * Tests pass their own so the whole suite shares a single connection, and the caller keeps
   * ownership of its lifecycle — we never disconnect a client we did not create.
   */
  client?: PrismaClient;
}

/** Build a client wired to pino. Kept separate so the log config stays a literal for `$on`. */
function createClient(app: FastifyInstance, env: Env): PrismaClient {
  const prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  // Prisma reports the statement and its duration here; bound parameter *values* are not
  // included, so game content cannot reach a log line through this path.
  prisma.$on('query', (event) => {
    app.log.debug({ durationMs: event.duration, query: event.query }, 'prisma query');
  });
  prisma.$on('warn', (event) => {
    app.log.warn({ target: event.target }, event.message);
  });
  prisma.$on('error', (event) => {
    app.log.error({ target: event.target }, event.message);
  });

  return prisma;
}

const prismaPlugin: FastifyPluginAsync<PrismaPluginOptions> = async (app, { env, client }) => {
  const prisma = client ?? createClient(app, env);

  app.decorate('prisma', prisma);
  app.decorate('transaction', ((work) => prisma.$transaction(work)) as TransactionRunner);

  app.decorate('withAdvisoryLock', (async (key, work) => {
    const [acquired] = await prisma.$queryRaw<
      { pg_try_advisory_lock: boolean }[]
    >`SELECT pg_try_advisory_lock(${key})`;

    if (acquired?.pg_try_advisory_lock !== true) return false;

    try {
      await work();
    } finally {
      await prisma.$queryRaw`SELECT pg_advisory_unlock(${key})`;
    }

    return true;
  }) as AdvisoryLockRunner);

  app.readiness.add('database', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  });

  // Only tear down what we built. A client handed to us belongs to the caller.
  if (client === undefined) {
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }
};

export default fp(prismaPlugin, { name: 'prisma', dependencies: ['readiness'] });
