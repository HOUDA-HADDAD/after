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
 * The two Phase 10 features, in a browser: a theme a group writes for itself (D19), and reactions
 * on an answer (D20).
 *
 * The interesting parts are the ones only a browser shows. A theme written on one screen has to
 * turn up in the picker on another. And a reaction is a live count in front of several people at
 * once — the number moving in someone else's tab without a reload is the whole feature.
 */

test.describe('a theme a group writes for itself', () => {
  test('goes from the group screen into the picker and onto the banner', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);

      await sarah.page.goto(`/groups/${groupId}`);
      await sarah.page.getByRole('button', { name: /write a theme/i }).click();

      await sarah.page.getByLabel('Name').fill('Unpopular opinions');
      await sarah.page.getByLabel('Icon').fill('🌶️');
      await sarah.page.getByLabel('Description').fill('Say the thing.');
      await sarah.page.getByLabel('Write prompt').fill('Write an unpopular opinion');
      await sarah.page.getByLabel('Answer prompt').fill('Defend it or demolish it');
      await sarah.page.getByRole('button', { name: /add it to the picker/i }).click();

      await expect(sarah.page.getByText('Unpopular opinions')).toBeVisible();

      // Into the picker, alongside the three defaults rather than instead of them.
      await sarah.page.getByRole('button', { name: 'New game' }).click();
      const option = sarah.page.getByRole('radio', { name: /Unpopular opinions/ });
      await expect(option).toBeVisible();
      await expect(sarah.page.getByRole('radio', { name: /Anecdotes/ })).toBeVisible();

      await option.click();
      await sarah.page.getByRole('button', { name: /open the lobby/i }).click();

      // And onto the banner, which stays pinned for the whole game.
      await expect(sarah.page.getByRole('heading', { name: 'Unpopular opinions' })).toBeVisible();

      // The prompt a player is asked is the one that was typed on the previous screen.
      await joinGame(ahmed, (await liveSessionId(sarah, groupId)) ?? '');
      await sarah.page.getByRole('button', { name: /start the game/i }).click();

      await expect(
        sarah.page.getByRole('textbox', { name: 'Write an unpopular opinion' }),
      ).toBeVisible();
    } finally {
      await closeAll(players);
    }
  });

  test('is invisible to a group that did not write it', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const lina = await signUp(browser, 'lina');
    const players = [sarah, lina];

    try {
      const theirs = await assembleGroup(sarah, []);
      const hers = await assembleGroup(lina, []);

      await api(sarah).post(`/api/v1/groups/${theirs}/themes`, {
        data: {
          name: 'Private jokes',
          description: 'Only makes sense here.',
          writePrompt: 'Write one',
          writePlaceholder: '',
          answerPrompt: 'Explain it',
          icon: '🃏',
          supportsComments: true,
          supportsAuthorGuess: true,
        },
      });

      await lina.page.goto(`/groups/${hers}`);
      await lina.page.getByRole('button', { name: 'New game' }).click();

      await expect(lina.page.getByRole('radio', { name: /Anecdotes/ })).toBeVisible();
      // A group's themes are its own — the route is scoped so this cannot be got wrong (D19).
      await expect(lina.page.getByRole('radio', { name: /Private jokes/ })).toHaveCount(0);
    } finally {
      await closeAll(players);
    }
  });
});

test.describe('reactions', () => {
  test('count up live in everyone else’s tab', async ({ browser }) => {
    const sarah = await signUp(browser, 'sarah');
    const ahmed = await signUp(browser, 'ahmed');
    const players = [sarah, ahmed];

    try {
      const groupId = await assembleGroup(sarah, [ahmed]);
      const prompts = await anecdotesPrompts(sarah, groupId);
      const sessionId = await openGame(sarah, groupId);

      await joinGame(ahmed, sessionId);
      await startGame(sarah, sessionId);

      for (const player of players) {
        await api(player).post(`/api/v1/sessions/${sessionId}/text/submit`, {
          data: { body: `${player.name} wrote a thing.` },
        });
      }

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

      for (const player of players) await player.page.goto(gameUrl(groupId, sessionId));
      await expect(sarah.page.getByRole('heading', { name: prompts.name })).toBeVisible();

      // A marker a reload would wipe, so "counted live" and "the page reloaded" stay separable.
      await ahmed.page.evaluate(() => {
        (window as unknown as { marker?: number }).marker = 1;
      });

      await sarah.page
        .getByRole('button', { name: /React with 😂/ })
        .first()
        .click();

      // Sarah's own button flips to the "remove" state…
      await expect(
        sarah.page.getByRole('button', { name: /Remove your 😂 reaction/ }).first(),
      ).toBeVisible();

      // …and ahmed sees the count, without having touched anything.
      await expect(
        ahmed.page.getByRole('button', { name: /React with 😂, 1 so far/ }),
      ).toBeVisible();
      expect(
        await ahmed.page.evaluate(() => (window as unknown as { marker?: number }).marker),
      ).toBe(1);

      // He adds his own; the count reaches two for both of them.
      await ahmed.page.getByRole('button', { name: /React with 😂, 1 so far/ }).click();

      await expect(
        sarah.page.getByRole('button', { name: /Remove your 😂 reaction/ }).first(),
      ).toContainText('2');

      // Taking it back is the same button again — and it never removes anyone else's (D20).
      await ahmed.page
        .getByRole('button', { name: /Remove your 😂 reaction/ })
        .first()
        .click();
      await expect(
        sarah.page.getByRole('button', { name: /Remove your 😂 reaction/ }).first(),
      ).toContainText('1');
    } finally {
      await closeAll(players);
    }
  });
});

/** The group's live game, if there is one. */
async function liveSessionId(
  player: Awaited<ReturnType<typeof signUp>>,
  groupId: string,
): Promise<string | null> {
  const response = await api(player).get(`/api/v1/groups/${groupId}/session`);
  const { session } = (await response.json()) as { session: { id: string } | null };

  return session?.id ?? null;
}
