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
        await expect(sarah.page.getByRole('heading', { name: 'Your rooms' })).toBeVisible();
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

/**
 * Every control is big enough to hit.
 *
 * 44×44 CSS pixels is the floor interaction guidelines converge on, and it is the rule most easily
 * lost to a redesign: a toolbar gets denser, an icon button drops to 32px, and nothing fails —
 * axe does not check target size at AA, so no other test in this repo would notice.
 *
 * The measurement deliberately accounts for the `.touch-target` pseudo-element, because that is
 * the whole point of it: several controls are drawn at 32px and *hit* at 44px, and a check that
 * only read `getBoundingClientRect` would report a failure that does not exist while missing a
 * real one elsewhere.
 */
const MEASURE_TARGETS = `(() => {
  const CONTROLS = 'button, select, input:not([type=hidden]), textarea, [role="button"], [role="radio"], [role="checkbox"]';
  const LINKS = 'a[href]';

  /*
   * Two floors, because there are two standards and conflating them produces noise.
   *
   *   - **44px** for controls. This is the interaction guideline the design commits to, and the
   *     one this codebase can always satisfy: a button's size is entirely ours to choose.
   *   - **24px** for links, which is WCAG 2.5.8 Target Size (Minimum) — the normative AA
   *     requirement. A link is sized by the words in it; padding a wordmark or an inline link out
   *     to 44px would wreck the line it sits on, which is why the standard sets a lower bar.
   */
  const FLOOR = { control: 44, link: 24 };
  const small = [];

  const measure = (el, floor) => {
    const box = el.getBoundingClientRect();

    if (box.width <= 1 || box.height <= 1) return;

    /*
     * Visually hidden until focused.
     *
     * The skip link is a keyboard affordance that no pointer ever aims at; while hidden it is
     * clipped away to nothing and only its padding gives it a bounding box at all. Both the
     * legacy \`clip\` and the modern \`clip-path\` form count, and so does a 1px declared size —
     * utility frameworks differ on which they use, and the box on screen is 0 either way.
     */
    const style = getComputedStyle(el);

    if (style.clip !== 'auto' || style.clipPath !== 'none') return;
    if (parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1) return;

    let width = box.width;
    let height = box.height;
    const after = getComputedStyle(el, '::after');

    // \`.touch-target\` expands the hit area past the drawn bounds; that expansion is the target.
    if (after.content && after.content !== 'none') {
      width = Math.max(width, parseFloat(after.minWidth) || 0);
      height = Math.max(height, parseFloat(after.minHeight) || 0);
    }

    if (width < floor || height < floor) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim();
      small.push(label.slice(0, 40) + ' — ' + Math.round(width) + 'x' + Math.round(height) +
                 ' (needs ' + floor + ')');
    }
  };

  /*
   * WCAG 2.5.8's "inline" exception, applied as the spec words it: a target whose size is
   * constrained by the line-height of the non-target text around it. Detected structurally — the
   * link shares its parent with other text — rather than by guessing from CSS, because a flex
   * container blockifies its children and \`display\` stops telling the truth.
   */
  const inSentence = (el) => {
    const parent = el.parentElement;

    if (parent === null) return false;

    return [...parent.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '',
    );
  };

  for (const el of document.querySelectorAll(CONTROLS)) measure(el, FLOOR.control);
  for (const el of document.querySelectorAll(LINKS)) if (!inSentence(el)) measure(el, FLOOR.link);

  return small;
})()`;

async function expectTouchTargets(page: Page, where: string): Promise<void> {
  const small = await page.evaluate<string[]>(MEASURE_TARGETS);

  expect(small, `${where}: targets below the minimum\n  ${small.join('\n  ')}`).toEqual([]);
}

test.describe('every control can be hit with a thumb', () => {
  test('meets the 44px minimum on every screen', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);
      const prompts = await anecdotesPrompts(sarah, groupId);

      const anonymous = await browser.newContext();
      const guest = await anonymous.newPage();

      await guest.goto('/login');
      await expect(guest.getByRole('button', { name: /sign in/i })).toBeVisible();
      await expectTouchTargets(guest, 'login');

      await guest.goto('/register');
      await expect(guest.getByRole('button', { name: /create account/i })).toBeVisible();
      await expectTouchTargets(guest, 'register');

      await anonymous.close();

      await sarah.page.goto('/');
      await expect(sarah.page.getByRole('heading', { name: 'Your rooms' })).toBeVisible();
      await expectTouchTargets(sarah.page, 'rooms');

      // The room page carries the densest toolbars in the app — the roster's punish/forgive
      // buttons, the room-code chip, and the theme cards.
      await sarah.page.goto(`/groups/${groupId}`);
      await expect(sarah.page.getByRole('heading', { name: 'Choose a theme' })).toBeVisible();
      await expectTouchTargets(sarah.page, 'room');

      const sessionId = await openGame(sarah, groupId);
      await joinGame(ahmed, sessionId);
      await startGame(sarah, sessionId);

      await sarah.page.goto(gameUrl(groupId, sessionId));
      await expect(sarah.page.getByRole('textbox', { name: prompts.write })).toBeVisible();
      await expectTouchTargets(sarah.page, 'writing');
    } finally {
      await closeAll([sarah, ahmed]);
    }
  });
});
