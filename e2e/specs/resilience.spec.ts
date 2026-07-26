import { test, expect } from '@playwright/test';
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
} from '../helpers/world.js';

/**
 * What happens when the network, or a player, goes away.
 *
 * These are the cases the design makes promises about (F9) and the ones a single-context suite
 * cannot reach: a socket that genuinely drops, and a game that has to continue without someone.
 */

test.describe('a dropped connection', () => {
  test('reconnects and resyncs without a reload', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);
      const prompts = await anecdotesPrompts(sarah);
      const sessionId = await openGame(sarah, groupId);

      await joinGame(ahmed, sessionId);
      await startGame(sarah, sessionId);

      await sarah.page.goto(gameUrl(groupId, sessionId));
      await expect(sarah.page.getByText('0 / 2 texts in')).toBeVisible();

      // Live first. Without this the offline assertion below would also pass on a socket that
      // never connected at all — the badge says "Connecting…" in both cases.
      await expect(sarah.page.getByRole('status')).toHaveCount(0, { timeout: 30_000 });

      // Survives a reload, so it can distinguish "resynced" from "reloaded" afterwards.
      await sarah.page.evaluate(() => {
        (window as unknown as { marker?: number }).marker = 7;
      });

      /* ---- the network goes away --------------------------------------------------------- */

      await sarah.context.setOffline(true);

      // The status appears only when it is actionable, which is precisely now.
      await expect(sarah.page.getByRole('status')).toHaveText(/reconnecting/i, { timeout: 30_000 });

      // The world moves on while she is away, and her tab has no way to know it.
      await api(ahmed).post(`/api/v1/sessions/${sessionId}/text/submit`, {
        data: { body: 'ahmed wrote this while sarah was offline.' },
      });

      await expect(sarah.page.getByText('0 / 2 texts in')).toBeVisible();

      /* ---- and comes back ---------------------------------------------------------------- */

      await sarah.context.setOffline(false);

      // The missed change arrives on reconnect: the socket rejoins its room and the cache is
      // invalidated, so the counter catches up on its own.
      await expect(sarah.page.getByText('1 / 2 texts in')).toBeVisible({ timeout: 60_000 });
      await expect(sarah.page.getByRole('status')).toHaveCount(0);

      // …and it was a resync, not a reload. This is the Phase 7 exit criterion, in a browser.
      expect(
        await sarah.page.evaluate(() => (window as unknown as { marker?: number }).marker),
      ).toBe(7);

      // The game is still usable afterwards, which is the part that actually matters.
      await sarah.page.getByRole('textbox', { name: prompts.write }).fill('sarah came back.');
      await sarah.page.getByRole('button', { name: /submit my text/i }).click();
      await expect(sarah.page.getByRole('textbox', { name: prompts.answer })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await closeAll(players);
    }
  });

  test('restores the exact phase after closing and reopening the tab', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);
      const prompts = await anecdotesPrompts(sarah);
      const sessionId = await openGame(sarah, groupId);

      await joinGame(ahmed, sessionId);
      await startGame(sarah, sessionId);

      await sarah.page.goto(gameUrl(groupId, sessionId));

      // A draft, autosaved rather than submitted.
      await sarah.page.getByRole('textbox', { name: prompts.write }).fill('half a story');
      await sarah.page.waitForTimeout(1200);

      await sarah.page.close();

      const reopened = await sarah.context.newPage();
      await reopened.goto(gameUrl(groupId, sessionId));

      // F9: the phase and the draft both come back, because neither was ever only in the tab.
      await expect(reopened.getByRole('textbox', { name: prompts.write })).toHaveValue(
        'half a story',
      );
    } finally {
      await closeAll(players);
    }
  });
});

test.describe('a player who never comes back', () => {
  test('lets the host force the game forward, and marks the gap honestly', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const lina = await signUp(browser, 'lina');
    const players = [sarah, ahmed, lina];

    try {
      const groupId = await assembleGroup(sarah, [ahmed, lina]);
      const prompts = await anecdotesPrompts(sarah);
      const sessionId = await openGame(sarah, groupId);

      for (const player of [ahmed, lina]) await joinGame(player, sessionId);
      await startGame(sarah, sessionId);

      await sarah.page.goto(gameUrl(groupId, sessionId));

      // Two of the three write; lina has left the party.
      for (const player of [sarah, ahmed]) {
        if (player === sarah) {
          await sarah.page.getByRole('textbox', { name: prompts.write }).fill('sarah wrote this.');
          await sarah.page.getByRole('button', { name: /submit my text/i }).click();
        } else {
          await api(player).post(`/api/v1/sessions/${sessionId}/text/submit`, {
            data: { body: 'ahmed wrote this.' },
          });
        }
      }

      // D14: the host can always move the game on, so one absent player cannot end it.
      await sarah.page.getByRole('button', { name: /deal the texts now/i }).click();
      await expect(sarah.page.getByRole('textbox', { name: prompts.answer })).toBeVisible({
        timeout: 20_000,
      });

      await sarah.page.getByRole('textbox', { name: prompts.answer }).fill('sarah answered.');
      await sarah.page.getByRole('button', { name: /submit answer/i }).click();

      await sarah.page.getByRole('button', { name: /move on to the results/i }).click();

      // lina's assignment was never answered, and the timeline says so rather than hiding it.
      await expect(sarah.page.getByText(/no answer/i).first()).toBeVisible({ timeout: 20_000 });
      // Two texts in the pile, because lina never wrote one.
      await expect(sarah.page.getByText('Written anonymously')).toHaveCount(2);
    } finally {
      await closeAll(players);
    }
  });
});

test.describe('a game that is gone', () => {
  test('reads as an ending rather than an error', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');

    try {
      const groupId = await assembleGroup(sarah, []);

      // What a player sees when the grace window elapsed while they were reading (D11). The
      // server cannot distinguish "deleted" from "never existed", and deliberately does not try.
      await sarah.page.goto(gameUrl(groupId, '00000000-0000-4000-8000-000000000000'));

      await expect(
        sarah.page.getByRole('heading', { name: /ended and been deleted/i }),
      ).toBeVisible();
      await expect(sarah.page.getByText(/that was the deal when you played it/i)).toBeVisible();

      await sarah.page.getByRole('button', { name: /back to the group/i }).click();
      await expect(sarah.page.getByRole('heading', { name: 'Friday Night' })).toBeVisible();
    } finally {
      await closeAll([sarah]);
    }
  });
});
