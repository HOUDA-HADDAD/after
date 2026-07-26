import { test, expect } from '@playwright/test';

/**
 * The deployment shape itself: one origin, the built client, the API beside it.
 *
 * If this fails, nothing below it means anything — and the failure is the one that would
 * otherwise be discovered in production, because it is the only arrangement development never
 * exercises (Vite serves the client there).
 */
test.describe('the served application', () => {
  test('serves the client at the root', async ({ page }) => {
    await page.goto('/');

    // Unauthenticated, so the app sends you to sign in — which proves the SPA booted and its
    // router ran, not merely that a file was returned.
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('serves a deep link into a client route', async ({ page }) => {
    // The refresh-mid-game case: a path the server has never heard of must still load the app.
    await page.goto('/groups/whatever/games/whatever');

    await expect(page).toHaveURL(/\/login/);
  });

  test('answers health checks', async ({ request }) => {
    expect((await request.get('/healthz')).status()).toBe(200);
    expect((await request.get('/readyz')).status()).toBe(200);
  });

  test('serves the API from the same origin', async ({ request }) => {
    const response = await request.get('/api/v1/version');

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'aftergame' });
  });

  test('does not answer an unknown API route with the client', async ({ request }) => {
    const response = await request.get('/api/v1/nope');

    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/problem+json');
  });
});
