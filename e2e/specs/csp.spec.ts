import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { cspDirectives, inlineScriptHashes } from '../../apps/api/src/plugins/security.js';
import {
  anecdotesPrompts,
  assembleGroup,
  closeAll,
  gameUrl,
  joinGame,
  openGame,
  signUp,
  startGame,
} from '../helpers/world.js';

/**
 * Does the app actually run under the policy production ships?
 *
 * The browser suite runs the server in development mode, because production insists on an https
 * origin (docs/09-deployment.md) — so without this spec the strict production CSP would be
 * asserted as a string by the integration tests and never once executed. That is precisely the
 * arrangement in which a policy that forbids something the app needs survives to a deploy.
 *
 * So the header is swapped for the real production one on the way in, and the app is made to do
 * the things a CSP tends to break: set an inline style attribute, open a WebSocket, load hashed
 * assets. Any violation the browser raises fails the test.
 */

const indexHtml = readFileSync(
  fileURLToPath(new URL('../../apps/web/dist/index.html', import.meta.url)),
  'utf8',
);

/**
 * The production policy, built by the server's own functions from the file the server serves.
 *
 * Neither the directives nor the script hashes are restated here, so this spec cannot pass
 * against a policy the server does not actually send.
 */
const productionCsp = Object.entries(
  cspDirectives({ isProduction: true, scriptHashes: inlineScriptHashes(indexHtml) }),
)
  .map(([directive, values]) => {
    const name = directive.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

    return `${name} ${values.join(' ')}`;
  })
  .join('; ');

test.describe('the production content security policy', () => {
  test('does not block anything the app needs', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);
      const prompts = await anecdotesPrompts(sarah);
      const sessionId = await openGame(sarah, groupId);

      await joinGame(ahmed, sessionId);
      await startGame(sarah, sessionId);

      // Swap the development policy for the production one, for everything this page loads.
      await sarah.page.route('**/*', async (route) => {
        try {
          const response = await route.fetch();
          const headers = { ...response.headers(), 'content-security-policy': productionCsp };

          await route.fulfill({ response, headers });
        } catch {
          // A request still in flight while the page is closing cannot be rewritten, and does not
          // need to be — the assertions have already run by then.
          await route.fallback().catch(() => undefined);
        }
      });

      const violations: string[] = [];

      await sarah.page.addInitScript(() => {
        window.addEventListener('securitypolicyviolation', (event) => {
          const store = ((window as unknown as { cspViolations?: string[] }).cspViolations ??= []);

          store.push(
            `${event.violatedDirective}: ${event.blockedURI} | ${event.sourceFile ?? '?'}:${String(event.lineNumber)} | ${(event as unknown as { sample?: string }).sample ?? ''}`,
          );
        });
      });

      await sarah.page.goto(gameUrl(groupId, sessionId));
      await expect(sarah.page.getByRole('textbox', { name: prompts.write })).toBeVisible();

      // The progress bar's width is an inline style attribute — the thing `style-src` blocks
      // unless `style-src-attr` says otherwise.
      const meter = sarah.page.getByRole('progressbar');
      await expect(meter).toBeVisible();

      const width = await meter
        .locator('div')
        .first()
        .evaluate((el) => el.style.width);
      expect(width, 'the progress bar kept its inline width').not.toBe('');

      // A live socket, which `connect-src` governs.
      await expect(sarah.page.getByRole('status')).toHaveCount(0, { timeout: 30_000 });

      violations.push(
        ...(await sarah.page.evaluate(
          () => (window as unknown as { cspViolations?: string[] }).cspViolations ?? [],
        )),
      );

      expect(
        violations,
        `CSP violations under the production policy:\n${violations.join('\n')}`,
      ).toEqual([]);
    } finally {
      await sarah.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
      await closeAll(players);
    }
  });

  test('still forbids what it is there to forbid', async ({ page }) => {
    // A policy that permits everything would pass the test above too, so this pins the other
    // side. Script is the directive that matters for XSS, and it stays closed: `'self'` plus the
    // hash of the one inline script we ship, and no `'unsafe-inline'` anywhere near it.
    expect(productionCsp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(productionCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(productionCsp).toContain("object-src 'none'");
    expect(productionCsp).toContain("frame-ancestors 'none'");
    expect(productionCsp).toContain("base-uri 'none'");
    expect(productionCsp).toContain("default-src 'self'");

    await page.goto('/login');
  });
});
