import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${String(PORT)}`;

/**
 * The browser suite.
 *
 * Everything below the browser is real: the built API serving the built client from one origin,
 * a real PostgreSQL, real migrations, the real seed. What this layer adds over the in-process
 * full-game suite is precisely what happens *in* a browser — live WebSocket traffic between
 * separate contexts, a network that can be taken away, computed styles, and focus under a real
 * compositor. Those are the reasons the earlier suites had to defer contrast and `inert` checks.
 *
 * Two projects, because "works on mobile" is the claim most easily made and least often true.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './.playwright/results',

  // Games are stateful and share one database; parallel files would race each other for a
  // group's single live-session slot.
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    // Kept only for failures: a passing run should produce no artefacts to sift through.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],

  webServer: {
    command: 'pnpm --filter @aftergame/api exec tsx scripts/e2e-server.ts',
    url: `${baseURL}/healthz`,
    // Embedded PostgreSQL has to boot, migrate and seed before the first request.
    timeout: 180_000,
    reuseExistingServer: process.env.CI === undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
