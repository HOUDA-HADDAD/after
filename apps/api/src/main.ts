import { resolve } from 'node:path';
import { loadEnv, loadEnvFileIfPresent, EnvValidationError } from '@aftergame/config';
import { buildApp } from './app.js';
import { seedThemes } from './modules/themes/system-themes.js';

/** The repository root holds the single `.env`, two levels up from apps/api. */
const REPO_ROOT_ENV = resolve(process.cwd(), '../../.env');

/**
 * Composition root.
 *
 * Load configuration, build the app, listen, and shut down cleanly. Configuration is validated
 * before anything else happens, and a bad value exits the process rather than booting a service
 * with a missing secret (docs/07-security.md, Secrets & configuration).
 */
async function main(): Promise<void> {
  // Local development reads the repository `.env`; production hosts inject real variables and
  // have no file, so both calls are no-ops there.
  if (!loadEnvFileIfPresent(REPO_ROOT_ENV)) {
    loadEnvFileIfPresent();
  }

  const env = loadEnv();
  const app = await buildApp({ env });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'failed to shut down cleanly');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  /**
   * Seed the default themes on every boot.
   *
   * Idempotent by slug, so it is safe to repeat, and it is here rather than in a release command
   * because the failure it prevents is silent: a deployment that migrated but never seeded starts
   * cleanly, answers `/readyz` with a 200, and offers an empty theme picker to anyone who tries
   * to start a game. Every health check calls that healthy.
   */
  try {
    const seeded = await seedThemes(app.prisma);
    app.log.info({ themes: seeded }, 'system themes ready');
  } catch (error) {
    app.log.error({ err: error }, 'could not seed the default themes');
    process.exit(1);
  }

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start');
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    // A configuration problem is a human problem: print it plainly, not as a stack trace.
    console.error(`\n${error.message}\n`);
    process.exit(78); // EX_CONFIG
  }

  console.error(error);
  process.exit(1);
});
