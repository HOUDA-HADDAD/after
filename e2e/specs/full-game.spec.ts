import { test, expect, type Page } from '@playwright/test';
import {
  anecdotesPrompts,
  assembleGroup,
  closeAll,
  gameUrl,
  joinGame,
  openGame,
  punish,
  signUp,
  startGame,
} from '../helpers/world.js';

/**
 * Three players, three browsers, one game — all on screen at the same time.
 *
 * The in-process suite already proves the flow against the real server; what it cannot prove is
 * anything that only exists in a browser. That is what this spec is for: a socket carrying a
 * change from one player's tab into another's without a reload, and a table watching the phase
 * turn over together.
 */

async function compose(page: Page, label: string, body: string, submit: RegExp): Promise<void> {
  await page.getByRole('textbox', { name: label }).first().fill(body);
  await page.getByRole('button', { name: submit }).first().click();
}

test.describe('a game played by three people at once', () => {
  test('runs from the lobby to the reveal, live', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const lina = await signUp(browser, 'lina');
    const everyone = [sarah, ahmed, lina];

    try {
      const groupId = await assembleGroup(sarah, [ahmed, lina]);
      const prompts = await anecdotesPrompts(sarah, groupId);

      // Twice, so ahmed comes in on level 2 and is dealt three texts rather than one.
      await punish(sarah, groupId, ahmed);
      await punish(sarah, groupId, ahmed);

      const sessionId = await openGame(sarah, groupId);

      /* ---- the lobby, watched by everyone ------------------------------------------------ */

      for (const player of everyone) await player.page.goto(gameUrl(groupId, sessionId));
      await expect(sarah.page.getByRole('heading', { name: prompts.name })).toBeVisible();

      // ahmed joins through the UI; the others are already looking at the lobby and must see him
      // arrive without touching anything. This is the socket doing its job in a real browser.
      await ahmed.page.getByRole('button', { name: /join the game/i }).click();
      await expect(lina.page.getByText(ahmed.name).first()).toBeVisible();

      await lina.page.getByRole('button', { name: /join the game/i }).click();
      await expect(sarah.page.getByText(lina.name).first()).toBeVisible();

      // The punishment load is public, because it is a rule of the game (D6).
      await expect(lina.page.getByText(new RegExp(`${ahmed.name} answers 3 texts`))).toBeVisible();

      /* ---- writing ----------------------------------------------------------------------- */

      await sarah.page.getByRole('button', { name: /start the game/i }).click();

      for (const player of everyone) {
        await expect(player.page.getByRole('textbox', { name: prompts.write })).toBeVisible();
      }

      // A marker that a reload would wipe. Without it, "updated live" and "the page happened to
      // reload" look identical from the outside.
      await lina.page.evaluate(() => {
        (window as unknown as { marker?: number }).marker = 1;
      });

      await compose(
        sarah.page,
        prompts.write,
        'I once baked a cake in a toaster.',
        /submit my text/i,
      );

      // Everyone else's counter moves on its own. No reload, no polling — an event arrived and
      // the affected query was refetched.
      for (const player of [ahmed, lina]) {
        await expect(player.page.getByText('1 / 3 texts in')).toBeVisible();
      }

      expect(
        await lina.page.evaluate(() => (window as unknown as { marker?: number }).marker),
      ).toBe(1);

      await compose(ahmed.page, prompts.write, 'I got lost in a supermarket.', /submit my text/i);
      await expect(lina.page.getByText('2 / 3 texts in')).toBeVisible();

      // Nobody is ever told who is still writing — the count is the only signal anonymity allows.
      await expect(lina.page.getByText(new RegExp(`waiting for ${sarah.name}`, 'i'))).toHaveCount(
        0,
      );

      await compose(
        lina.page,
        prompts.write,
        'I told my class I had a pet owl.',
        /submit my text/i,
      );

      /* ---- answering --------------------------------------------------------------------- */

      // The last text triggers distribution, and the phase turns over for the whole table at once.
      for (const player of everyone) {
        await expect(
          player.page.getByRole('textbox', { name: prompts.answer }).first(),
        ).toBeVisible({ timeout: 20_000 });
      }

      await expect(ahmed.page.getByRole('textbox', { name: prompts.answer })).toHaveCount(3);
      await expect(sarah.page.getByRole('textbox', { name: prompts.answer })).toHaveCount(1);

      for (const player of everyone) {
        const boxes = player.page.getByRole('textbox', { name: prompts.answer });

        for (let index = (await boxes.count()) - 1; index >= 0; index -= 1) {
          await player.page
            .getByRole('textbox', { name: prompts.answer })
            .first()
            .fill(`${player.name} says something.`);
          await player.page
            .getByRole('button', { name: /submit answer/i })
            .first()
            .click();
          await expect(player.page.getByRole('textbox', { name: prompts.answer })).toHaveCount(
            index,
            { timeout: 20_000 },
          );
        }
      }

      /* ---- the timeline ------------------------------------------------------------------ */

      for (const player of everyone) {
        await expect(player.page.getByText(/toaster/)).toBeVisible({ timeout: 20_000 });
        // Three texts, three anonymous attributions, and not a name among them.
        await expect(player.page.getByText('Written anonymously')).toHaveCount(3);
        await expect(player.page.getByText(/^Written by /)).toHaveCount(0);
      }

      // A comment posted in one browser appears in the others, live.
      await ahmed.page
        .getByRole('textbox', { name: 'Add a comment' })
        .first()
        .fill('That is bold.');
      await ahmed.page.getByRole('button', { name: 'Post' }).first().click();

      await expect(sarah.page.getByText('That is bold.')).toBeVisible();
      await expect(lina.page.getByText(/Anonymous — That is bold\./)).toBeVisible();

      // A guess, with no hint of whether it landed (D9).
      await sarah.page
        .getByRole('group', { name: 'Guess the author' })
        .first()
        .getByRole('button')
        .first()
        .click();
      await expect(sarah.page.getByText(/Saved\./).first()).toBeVisible();
      await expect(sarah.page.getByText(/that was right|that was wrong/i)).toHaveCount(0);

      /* ---- the reveal -------------------------------------------------------------------- */

      await sarah.page.getByRole('button', { name: /move to the reveal vote/i }).click();

      for (const player of everyone) {
        await expect(player.page.getByText(/your choice is private/i)).toBeVisible();
        // Three players is small enough that a refusal is inferable, and the screen says so.
        await expect(player.page.getByText(/narrows down who refused/i)).toBeVisible();
      }

      await sarah.page.getByRole('button', { name: /reveal the authors/i }).click();
      await ahmed.page.getByRole('button', { name: /reveal the authors/i }).click();
      await lina.page.getByRole('button', { name: /keep us anonymous/i }).click();

      // One refusal, and the table stays anonymous — for the two who voted yes as well (D8).
      for (const player of everyone) {
        await expect(player.page.getByText(/the group chose to stay anonymous/i)).toBeVisible({
          timeout: 20_000,
        });
        await expect(player.page.getByText(/^Written by /)).toHaveCount(0);
        await expect(player.page.getByText(/who read the room/i)).toHaveCount(0);
      }
    } finally {
      await closeAll(everyone);
    }
  });

  test('reveals every name when the whole table agrees', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const everyone = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);
      const prompts = await anecdotesPrompts(sarah, groupId);
      const sessionId = await openGame(sarah, groupId);

      await joinGame(ahmed, sessionId);
      await startGame(sarah, sessionId);

      for (const player of everyone) {
        await player.page.goto(gameUrl(groupId, sessionId));
        await compose(player.page, prompts.write, `${player.name} wrote this.`, /submit my text/i);
      }

      for (const player of everyone) {
        await expect(player.page.getByRole('textbox', { name: prompts.answer })).toBeVisible({
          timeout: 20_000,
        });
        await compose(player.page, prompts.answer, `${player.name} answered.`, /submit answer/i);
      }

      await expect(sarah.page.getByText(/wrote this/).first()).toBeVisible({ timeout: 20_000 });
      await sarah.page.getByRole('button', { name: /move to the reveal vote/i }).click();

      // Two players: the screen says outright that a refusal identifies whoever made it.
      await expect(sarah.page.getByText(/identifies them outright/i)).toBeVisible();

      for (const player of everyone) {
        await player.page.getByRole('button', { name: /reveal the authors/i }).click();
      }

      for (const player of everyone) {
        await expect(player.page.getByText(/everyone agreed/i)).toBeVisible({ timeout: 20_000 });
        await expect(player.page.getByText(`Written by ${sarah.name}`)).toBeVisible();
        await expect(player.page.getByText(`Written by ${ahmed.name}`)).toBeVisible();
        await expect(player.page.getByText(/who read the room/i)).toBeVisible();
      }
    } finally {
      await closeAll(everyone);
    }
  });
});
