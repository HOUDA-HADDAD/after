import { test, expect } from '@playwright/test';
import { assembleGroup, closeAll, gameUrl, openGame, punish, signUp } from '../helpers/world.js';

/**
 * The punishment ladder, from the outside.
 *
 * The rules themselves are proved exhaustively in `game-core` and over HTTP in the integration
 * suite. What is left for a browser is whether the app *says* what it is doing: a load that is
 * announced before anyone commits to it, and a block that is explained rather than enforced by a
 * missing button.
 */

test.describe('a blocked player', () => {
  test('is told why, instead of finding the door locked', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);

      // Three consecutive punishments is the block (D7).
      for (let round = 0; round < 3; round += 1) await punish(sarah, groupId, ahmed);

      const sessionId = await openGame(sarah, groupId);

      await ahmed.page.goto(gameUrl(groupId, sessionId));

      // The explanation replaces the join button rather than sitting beside a dead one.
      await expect(ahmed.page.getByText(/until a host forgives you/i)).toBeVisible();
      await expect(ahmed.page.getByRole('button', { name: /join the game/i })).toHaveCount(0);

      // And the rest of the group still works — the block is about games, not membership.
      await ahmed.page.goto(`/groups/${groupId}`);
      await expect(ahmed.page.getByRole('heading', { name: 'Friday Night' }).first()).toBeVisible();
    } finally {
      await closeAll(players);
    }
  });

  test('shows the group who is sitting out, and why', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);

      for (let round = 0; round < 3; round += 1) await punish(sarah, groupId, ahmed);

      const sessionId = await openGame(sarah, groupId);
      await sarah.page.goto(gameUrl(groupId, sessionId));

      // Punishment is public within the group by design (D6) — a player who silently vanished
      // from the lobby would be a mystery rather than a consequence.
      await expect(sarah.page.getByText(/sitting this one out/i)).toBeVisible();
      await expect(
        sarah.page.getByText(new RegExp(`${ahmed.name} — blocked from games`)),
      ).toBeVisible();
    } finally {
      await closeAll(players);
    }
  });

  test('gets back in as soon as a host forgives them', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);

      for (let round = 0; round < 3; round += 1) await punish(sarah, groupId, ahmed);

      const sessionId = await openGame(sarah, groupId);
      await ahmed.page.goto(gameUrl(groupId, sessionId));
      await expect(ahmed.page.getByText(/until a host forgives you/i)).toBeVisible();

      // The host forgives from the group screen, through the UI. Scoped to the roster inside the
      // main panel: the sidebar lists the same people, and so does the punishment history below.
      await sarah.page.goto(`/groups/${groupId}`);
      const roster = sarah.page.locator('main').getByRole('region', { name: 'Players' });

      await expect(roster.getByText(ahmed.name)).toBeVisible();
      await roster.getByRole('button', { name: 'Forgive' }).click();

      await ahmed.page.reload();
      await expect(ahmed.page.getByRole('button', { name: /join the game/i })).toBeVisible();
    } finally {
      await closeAll(players);
    }
  });
});
