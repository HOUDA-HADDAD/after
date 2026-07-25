import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** The repository root, where the single `.env` lives. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const toPort = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
};

/**
 * The proxy matters more than it looks.
 *
 * Production serves the API and the SPA from one origin (docs/01-architecture.md §1). Proxying
 * in development means the browser sees one origin here too, so cookies, the CSRF origin check
 * and WebSocket upgrades behave identically in both environments — no "works in dev" surprises.
 */
export default defineConfig(({ mode }) => {
  // Read the repository .env with no prefix filter, so the dev server and the API agree on ports.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };

  const webPort = toPort(env.WEB_PORT, 5173);
  const apiTarget = env.VITE_API_TARGET ?? `http://localhost:${toPort(env.PORT, 3000)}`;
  const proxy = { target: apiTarget, changeOrigin: false };

  return {
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    server: {
      port: webPort,
      // Deliberately strict: silently moving to another port would break APP_ORIGIN, and the
      // CSRF origin check would then reject every write with a confusing 403. Set WEB_PORT
      // (and APP_ORIGIN to match) if the default is taken.
      strictPort: true,
      proxy: {
        '/api': proxy,
        '/healthz': proxy,
        '/readyz': proxy,
        '/socket.io': { ...proxy, ws: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2022',
    },
  };
});
