import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],

    // One database serves the whole run and tests TRUNCATE between cases, so files must not
    // overlap. A single fork also means a single Prisma client, which the PGlite fallback
    // requires — its socket server serves one connection at a time.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    // PGlite has to boot a WASM PostgreSQL before the first test can run.
    testTimeout: 20_000,
    hookTimeout: 60_000,

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
    },
  },
});
