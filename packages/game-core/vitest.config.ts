import { defineConfig } from 'vitest/config';

/**
 * Coverage is a gate here and nowhere else.
 *
 * This package is small, pure, and contains every rule that decides how a game plays out and who
 * is allowed to see whose name. An untested branch is a rule nobody has checked, so the threshold
 * is 100% and it fails the build rather than printing a warning (docs/08-testing.md).
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The barrel is re-exports only; there is nothing in it to cover.
      exclude: ['src/index.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
