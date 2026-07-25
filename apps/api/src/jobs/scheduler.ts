import fp from 'fastify-plugin';
import cron from 'node-cron';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '@aftergame/config';
import { createMaintenanceJobs, type MaintenanceJobs } from './maintenance.js';

declare module 'fastify' {
  interface FastifyInstance {
    maintenance: MaintenanceJobs;
    /** The validated configuration, so jobs and services can read limits without re-parsing. */
    appEnv: Env;
  }
}

/** Every ten minutes. Nothing here is urgent — a session lingering ten minutes past its window
 *  costs nothing, and a tighter schedule would only add load. */
const MAINTENANCE_CRON = '*/10 * * * *';

/**
 * The scheduler.
 *
 * `node-cron` rather than a queue, because there is no workload here that justifies another
 * service to run, monitor and keep free (docs/01-architecture.md §9). Each task takes a
 * PostgreSQL advisory lock, so running several API instances never double-executes one.
 *
 * Disabled under test: a timer firing mid-assertion is a source of flakes, and the jobs are
 * invoked directly by the tests instead.
 */
const schedulerPlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  app.decorate('appEnv', env);
  app.decorate('maintenance', createMaintenanceJobs(app));

  if (env.NODE_ENV === 'test') return;

  const task = cron.schedule(MAINTENANCE_CRON, () => {
    void app.maintenance.runAll().catch((error: unknown) => {
      // A failed sweep must never take the process down; the next one is ten minutes away.
      app.log.error({ err: error }, 'maintenance sweep failed');
    });
  });

  app.addHook('onClose', async () => {
    await task.stop();
  });

  app.log.info({ schedule: MAINTENANCE_CRON }, 'maintenance scheduled');
};

export default fp(schedulerPlugin, { name: 'scheduler', dependencies: ['prisma', 'services'] });
