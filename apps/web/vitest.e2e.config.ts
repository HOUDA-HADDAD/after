import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The full-game suite.
 *
 * Separate from the component suite because it needs a database and takes a minute rather than a
 * second — but it runs under `pnpm test`, not behind a flag. A test that proves the product works
 * and that nobody runs is not a test.
 *
 * The React app renders in happy-dom while the real Fastify app runs in the same process, so one
 * config has to serve both. That is the whole trick: the client's `fetch` reaches the actual
 * server rather than a fixture that agrees with it.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/e2e/**/*.test.tsx'],
    globalSetup: ['./tests/e2e/global-setup.ts'],

    // One database, one Prisma client, one game at a time.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    // Embedded PostgreSQL has to boot, migrate and seed before the first assertion.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
