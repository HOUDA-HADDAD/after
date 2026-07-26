import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  anecdotesPrompts,
  api,
  assembleGroup,
  closeAll,
  gameUrl,
  joinGame,
  openGame,
  signUp,
  startGame,
  type Player,
} from '../helpers/world.js';

/**
 * The accessibility check that counts.
 *
 * The component suite runs axe too, but in happy-dom, which computes no styles and implements no
 * `inert` — so `color-contrast` and `aria-hidden-focus` are disabled there and deferred to here
 * (docs/08-testing.md). This file is where that promise is kept: a real engine, real computed
 * colours, real focus, and **no rules disabled**.
 */

/**
 * Freeze transitions before the page ever paints.
 *
 * axe samples whatever colour an element has at the instant it runs. Catch one part-way through a
 * `transition-colors` and it reports a blend of two states that nobody ever reads — which showed
 * up here as an intermittent contrast failure whose reported colours matched neither theme, being
 * the midpoint of both. WCAG is about the colours a person actually sees.
 *
 * Injected as an init script rather than after load: a stylesheet added afterwards ends a
 * transition, but only once it has already started, and the audit can arrive first.
 */
const FREEZE = `*, *::before, *::after {
  transition: none !important;
  animation: none !important;
}`;

async function freezeAnimations(context: BrowserContext): Promise<void> {
  await context.addInitScript((css: string) => {
    const apply = (): void => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    };

    if (document.head as HTMLElement | null) apply();
    else document.addEventListener('DOMContentLoaded', apply);
  }, FREEZE);
}

async function audit(page: Page, context?: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const summary = results.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n` +
        violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n'),
    )
    .join('\n');

  expect(results.violations, `${context ?? page.url()}\n${summary}`).toEqual([]);
}

test.describe('every screen, in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`passes WCAG 2.1 AA in ${theme} mode`, async ({ browser }) => {
      const sarah = await signUp(browser, 'sarah');
      const ahmed = await signUp(browser, 'ahmed');
      const players: Player[] = [sarah, ahmed];

      try {
        // The app stores the choice; setting it before the first paint avoids auditing a flash of
        // the other theme.
        await sarah.context.addInitScript((value: string) => {
          window.localStorage.setItem('aftergame:theme', value);
        }, theme);
        await freezeAnimations(sarah.context);

        const groupId = await assembleGroup(sarah, [ahmed]);
        const prompts = await anecdotesPrompts(sarah, groupId);

        /* ---- signed out ----------------------------------------------------------------- */

        const anonymous = await browser.newContext();

        // Both init scripts before the first page, so nothing is ever painted un-themed or
        // mid-transition.
        await anonymous.addInitScript((value: string) => {
          window.localStorage.setItem('aftergame:theme', value);
        }, theme);
        await freezeAnimations(anonymous);

        const guest = await anonymous.newPage();

        await guest.goto('/login');
        await expect(guest.getByRole('heading', { name: /sign in/i })).toBeVisible();
        await audit(guest, `login (${theme})`);

        await guest.goto('/register');
        await expect(guest.getByRole('heading', { name: /create/i })).toBeVisible();
        await audit(guest, `register (${theme})`);

        await anonymous.close();

        /* ---- signed in ------------------------------------------------------------------ */

        await sarah.page.goto('/');
        await expect(sarah.page.getByRole('heading', { name: 'Your groups' })).toBeVisible();
        await audit(sarah.page, `groups (${theme})`);

        await sarah.page.goto(`/groups/${groupId}`);
        // The name appears in the sidebar as well as the page heading, hence `.first()`.
        await expect(
          sarah.page.getByRole('heading', { name: 'Friday Night' }).first(),
        ).toBeVisible();
        await audit(sarah.page, `group detail (${theme})`);

        /* ---- every phase of a game ------------------------------------------------------ */

        const sessionId = await openGame(sarah, groupId);
        await joinGame(ahmed, sessionId);

        await sarah.page.goto(gameUrl(groupId, sessionId));
        await expect(sarah.page.getByRole('heading', { name: prompts.name })).toBeVisible();
        await audit(sarah.page, `lobby (${theme})`);

        await startGame(sarah, sessionId);
        await sarah.page.reload();
        await expect(sarah.page.getByRole('textbox', { name: prompts.write })).toBeVisible();
        await audit(sarah.page, `writing (${theme})`);

        for (const player of players) {
          await api(player).post(`/api/v1/sessions/${sessionId}/text/submit`, {
            data: { body: `${player.name} wrote a thing.` },
          });
        }

        await sarah.page.reload();
        await expect(sarah.page.getByRole('textbox', { name: prompts.answer })).toBeVisible();
        await audit(sarah.page, `answering (${theme})`);

        for (const player of players) {
          const state = (await (await api(player).get(`/api/v1/sessions/${sessionId}`)).json()) as {
            you: { assignments: { assignmentId: string }[] };
          };

          for (const assignment of state.you.assignments) {
            await api(player).post(
              `/api/v1/sessions/${sessionId}/assignments/${assignment.assignmentId}/answer/submit`,
              { data: { body: `${player.name} answered.` } },
            );
          }
        }

        await sarah.page.reload();
        await expect(sarah.page.getByText(/wrote a thing/).first()).toBeVisible();
        await audit(sarah.page, `timeline (${theme})`);

        await api(sarah).post(`/api/v1/sessions/${sessionId}/end`);
        await sarah.page.reload();
        await expect(sarah.page.getByText(/your choice is private/i)).toBeVisible();
        await audit(sarah.page, `reveal (${theme})`);

        for (const player of players) {
          await api(player).post(`/api/v1/sessions/${sessionId}/reveal-vote`, {
            data: { choice: 'YES' },
          });
        }

        await sarah.page.reload();
        await expect(sarah.page.getByText(/everyone agreed/i)).toBeVisible();
        await audit(sarah.page, `completed (${theme})`);
      } finally {
        await closeAll(players);
      }
    });
  }
});

test.describe('the mobile drawer', () => {
  test.skip(({ isMobile }) => isMobile !== true, 'only exists below the md breakpoint');

  test('traps focus, closes on Escape, and returns focus to its trigger', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');

    try {
      const groupId = await assembleGroup(sarah, []);

      await freezeAnimations(sarah.context);
      await sarah.page.goto(`/groups/${groupId}`);

      const trigger = sarah.page.getByRole('button', { name: 'Open navigation' });
      await expect(trigger).toBeVisible();
      await trigger.click();

      const dialog = sarah.page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // The rules happy-dom could not answer: with the drawer open, is the background genuinely
      // out of reach, and are the aria-hidden subtrees free of focusable content?
      await audit(sarah.page, 'drawer open');

      // `inert` in a real engine. It does not hide anything — it makes it unreachable, so the
      // check is whether focus can get there, not whether it can be seen.
      await expect(sarah.page.locator('[inert]')).toHaveCount(1);

      for (let press = 0; press < 12; press += 1) {
        await sarah.page.keyboard.press('Tab');

        const trapped = await sarah.page.evaluate(() => {
          const active = document.activeElement;

          return active === null || active.closest('[role="dialog"]') !== null;
        });

        expect(trapped, `focus escaped the drawer after ${String(press + 1)} tabs`).toBe(true);
      }

      await sarah.page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // Losing focus to the body after closing a dialog strands a keyboard user.
      await expect(trigger).toBeFocused();
    } finally {
      await closeAll([sarah]);
    }
  });
});
