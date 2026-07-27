import { test, expect, type Page } from '@playwright/test';
import { fr } from '../../apps/web/src/shared/i18n/translations.js';
import {
  anecdotesPrompts,
  assembleGroup,
  closeAll,
  gameUrl,
  joinGame,
  openGame,
  signUp,
  type Player,
} from '../helpers/world.js';

/**
 * The app, played in French.
 *
 * The unit suite proves the dictionary is complete and that the switcher takes effect in the
 * shell. Neither can prove what a French player actually sees once a game is running — the game
 * screens render from server state, and a screen that never mounts in a French test is a screen
 * nobody checked.
 *
 * Assertions read from the `fr` dictionary rather than quoting French inline. Quoting would mean
 * every copy edit breaks a spec in a second language, and a spec that is expensive to keep true
 * gets deleted. Reading from the dictionary asserts the thing that actually matters: this screen
 * renders the French entry, not the English one.
 */

/** Start in French the way a French browser does, before the app's first paint. */
async function inFrench(player: Player): Promise<void> {
  await player.context.addInitScript(() => {
    localStorage.setItem('aftergame:locale', 'fr');
  });
}

/** Every visible string on the page, as one blob to search. */
const visibleText = async (page: Page): Promise<string> =>
  (await page.locator('body').innerText()).replace(/\s+/g, ' ');

/**
 * Wait until the socket is live.
 *
 * The shell shows a status badge only while the connection is not live, so its absence is the
 * signal. Without this the spec races: a phase change published before a player's `subscribe`
 * reaches the server goes to a room they are not in yet, and their screen never moves. That is a
 * real race, but it needs a game started within a few hundred milliseconds of someone opening the
 * page — which a script does and a table of people does not.
 */
async function awaitLive(player: Player): Promise<void> {
  await expect(player.page.getByRole('status').filter({ hasText: /…/ })).toHaveCount(0, {
    timeout: 20_000,
  });
}

test.describe('the app in French', () => {
  test('stays French from the lobby through to the reveal', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const lina = await signUp(browser, 'lina');
    const everyone = [sarah, ahmed, lina];

    try {
      for (const player of everyone) await inFrench(player);

      const groupId = await assembleGroup(sarah, [ahmed, lina]);
      const prompts = await anecdotesPrompts(sarah, groupId);

      /* ---- the room page ------------------------------------------------------------------ */

      await sarah.page.goto(`/groups/${groupId}`);

      // The room header, the theme picker and the player list — the three panels of the lobby
      // redesign, each a separate component and so each its own chance to have been missed.
      await expect(sarah.page.getByRole('heading', { name: fr['lobby.noGame'] })).toBeVisible();
      await expect(sarah.page.getByRole('heading', { name: fr['themes.title'] })).toBeVisible();
      // `first`, not a count: the sidebar renders a second one on desktop and hides inside the
      // drawer on a phone, and this spec is about the language, not the layout.
      await expect(
        sarah.page.getByRole('heading', { name: fr['players.title'] }).first(),
      ).toBeVisible();
      await expect(sarah.page.getByRole('button', { name: fr['room.copyCode'] })).toBeVisible();

      // Roles and member counts are `Record` lookups and plural helpers — shapes the source sweep
      // cannot see, and where the English survived longest. The sidebar and the main panel render
      // them from different components, so the negative assertions cover both.
      const room = await visibleText(sarah.page);

      expect(room).toContain(fr['players.role.OWNER']);
      expect(room).toContain(fr['players.role.MEMBER']);
      expect(room).toContain(fr['room.members'].replace('{count}', '3'));
      expect(room).not.toContain('Owner');
      expect(room).not.toContain('members');

      /* ---- the game lobby ------------------------------------------------------------------ */

      const sessionId = await openGame(sarah, groupId);
      await joinGame(ahmed, sessionId);
      await joinGame(lina, sessionId);

      for (const player of everyone) await player.page.goto(gameUrl(groupId, sessionId));

      for (const player of everyone) {
        await expect(player.page.getByRole('heading', { name: fr['gameLobby.who'] })).toBeVisible();
        await awaitLive(player);
      }

      /* ---- writing -------------------------------------------------------------------------- */

      // Through the UI, so the button's own French label is what starts the game.
      await sarah.page.getByRole('button', { name: fr['gameLobby.start'] }).click();

      for (const player of everyone) {
        await expect(player.page.getByRole('button', { name: fr['writing.submit'] })).toBeVisible({
          timeout: 20_000,
        });
      }

      // The phase chip is driven by a map keyed on the server's enum, so it is translated
      // separately from everything around it.
      expect(await visibleText(sarah.page)).toContain(fr['phase.WRITING']);

      for (const player of everyone) {
        await player.page.getByRole('textbox', { name: prompts.write }).first().fill('Un secret.');
        await player.page.getByRole('button', { name: fr['writing.submit'] }).first().click();
      }

      /* ---- answering ------------------------------------------------------------------------ */

      // No host click here: the last text in triggers distribution on its own, so the deal button
      // is already gone by the time the third player submits.
      for (const player of everyone) {
        await expect(
          player.page.getByRole('textbox', { name: prompts.answer }).first(),
        ).toBeVisible({ timeout: 20_000 });

        await player.page
          .getByRole('textbox', { name: prompts.answer })
          .first()
          .fill('Ma réponse.');
        await player.page.getByRole('button', { name: fr['answering.submit'] }).first().click();

        // The card leaves when the answer lands, which is what makes the next iteration safe.
        await expect(player.page.getByRole('textbox', { name: prompts.answer })).toHaveCount(0, {
          timeout: 20_000,
        });
      }

      /* ---- the timeline and the reveal vote ------------------------------------------------- */

      // Several: the header badge, and the "post as anonymous" toggle on every comment box.
      await expect(sarah.page.getByText(fr['timeline.anonymous']).first()).toBeVisible({
        timeout: 20_000,
      });
      expect(await visibleText(sarah.page)).toContain(fr['phase.REVIEW']);

      await sarah.page.getByRole('button', { name: fr['timeline.toReveal'] }).click();

      for (const player of everyone) {
        await expect(player.page.getByRole('heading', { name: fr['reveal.question'] })).toBeVisible(
          { timeout: 20_000 },
        );
      }

      // English anywhere on a fully French screen is the failure this whole spec exists to catch.
      // The room name is the group's own and stays as typed.
      const reveal = await visibleText(sarah.page);
      expect(reveal).toContain(fr['reveal.unanimous'].replace(/\s+/g, ' '));
      expect(reveal).not.toContain('Reveal the authors');
      expect(reveal).not.toContain('Keep us anonymous');
    } finally {
      await closeAll(everyone);
    }
  });
});
