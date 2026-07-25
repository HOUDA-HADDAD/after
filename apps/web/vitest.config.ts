import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom rather than jsdom: faster to start, and everything the shell touches — focus,
    // dialogs, media queries — is supported.
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'src/**/*.test.tsx'],
    // The full-game suite needs a database and its own global setup, so it runs under
    // vitest.e2e.config.ts. Both are wired into `pnpm test`; this only keeps them apart.
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
