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
  },
});
