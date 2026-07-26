import { describe, it, expect, beforeAll, afterAll, inject, vi } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@aftergame/config';
import { SESSION_COOKIE_NAME_INSECURE, type SessionThemeDto } from '@aftergame/shared';
import { buildApp } from '../../../api/src/app.js';
import { createQueryClient } from '../../src/shared/api/queries.js';
import { SessionProvider } from '../../src/features/auth/SessionProvider.js';
import { SocketProvider } from '../../src/shared/realtime/SocketProvider.js';
import { LocaleProvider } from '../../src/shared/i18n/LocaleProvider.js';
import GroupDetailPage from '../../src/features/groups/GroupDetailPage.js';
import GamePage from '../../src/features/game/GamePage.js';
import { setViewportWidth, VIEWPORTS } from '../helpers/viewport.js';

/**
 * Three players, one complete game, through the real screens and the real server.
 *
 * This is Phase 8's exit criterion, and it is deliberately not a mock of anything: the Fastify
 * app runs in this process against a real PostgreSQL, and each player's `fetch` carries their own
 * session cookie to it. What the components render is what the projection actually produced for
 * that viewer — so an anonymity assertion here is a statement about the product, not about a
 * fixture somebody wrote to agree with it.
 *
 * Players take turns rather than sharing a screen, which is how three phones work anyway, and it
 * buys a second guarantee for free: every turn is a fresh mount reading the game back from the
 * server, so the flow doubles as proof that a player who closes the tab returns to exactly the
 * phase the game is in (F9).
 */

let app: FastifyInstance;
let prisma: PrismaClient;

interface Player {
  name: string;
  token: string;
  userId: string;
  /** Their device. Three humans do not all play on the same screen. */
  width: number;
}

/* ---- talking to the real server ------------------------------------------------------------ */

const cookieFor = (token: string): string => `${SESSION_COOKIE_NAME_INSECURE}=${token}`;

/** Route the browser's `fetch` into the in-process server, as this player. */
function signInAs(token: string): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    // The content-type header goes on only when there is a body, exactly as the browser does it.
    // Declaring JSON and then sending nothing is a 400 from Fastify, and it would be a fault of
    // this harness rather than of the app.
    const response = await app.inject({
      method: (init.method ?? 'GET') as 'GET',
      url: String(input),
      headers: {
        cookie: cookieFor(token),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { payload: JSON.parse(String(init.body)) as object }),
    });

    return new Response(response.statusCode === 204 ? null : response.body, {
      status: response.statusCode,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const api = async (token: string, method: string, url: string, payload?: object) =>
  app.inject({
    method: method as 'POST',
    url: `/api/v1${url}`,
    headers: { cookie: cookieFor(token) },
    ...(payload === undefined ? {} : { payload }),
  });

async function register(name: string, width: number): Promise<Player> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: name,
      email: `${name}@example.com`,
      password: 'a decently long passphrase',
    },
  });

  if (response.statusCode !== 201) throw new Error(`register ${name}: ${response.body}`);

  const token = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME_INSECURE)?.value;
  if (token === undefined) throw new Error(`register ${name}: no session cookie`);

  return { name, token, userId: (response.json() as { user: { id: string } }).user.id, width };
}

/* ---- taking a turn ------------------------------------------------------------------------- */

const routes = (
  <Routes>
    <Route path="/groups/:groupId" element={<GroupDetailPage />} />
    <Route path="/groups/:groupId/games/:sessionId" element={<GamePage />} />
  </Routes>
);

/**
 * Hand the screen to one player: their cookie, their device width, a fresh app.
 *
 * Everything is torn down afterwards, so nothing carries between turns except what the database
 * kept — which is the point.
 */
async function playAs(player: Player, route: string, turn: () => Promise<void>): Promise<void> {
  signInAs(player.token);
  setViewportWidth(player.width);

  render(
    <QueryClientProvider client={createQueryClient()}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[route]}>
          <SessionProvider>
            <SocketProvider>{routes}</SocketProvider>
          </SessionProvider>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );

  try {
    await turn();
  } finally {
    cleanup();
  }
}

const user = () => userEvent.setup();

/** Wait for the game to be on screen — the theme banner is pinned in every phase. */
const gameOnScreen = () => screen.findByRole('heading', { name: 'Anecdotes' }, { timeout: 10_000 });

/** Write a text, or answer one: the composer is the same component in both phases. */
async function compose(label: string, body: string, submitLabel: RegExp): Promise<void> {
  const ui = user();
  const boxes = await screen.findAllByRole('textbox', { name: label });

  await ui.type(boxes[0]!, body);
  await ui.click(screen.getAllByRole('button', { name: submitLabel })[0]!);
}

/* ---- the fixture --------------------------------------------------------------------------- */

let sarah: Player;
let ahmed: Player;
let lina: Player;
let groupId: string;

/**
 * The theme's own prompts, read from the seeded row rather than hard-coded here.
 *
 * Themes are data (D15): the copy on the composer belongs to the row in the database, and a test
 * that repeated it would start failing the day someone reworded a theme — while proving nothing
 * about whether the screen used it.
 */
let anecdotes: SessionThemeDto;

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });

  app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: inject('databaseUrl'),
      SESSION_SECRET: 'test-secret-that-is-at-least-32-chars',
      APP_ORIGIN: 'http://localhost:5173',
      RATE_LIMIT_ENABLED: 'false',
      LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'silent',
      ARGON2_MEMORY_KIB: '8192',
      ARGON2_TIME_COST: '1',
    }),
    prismaClient: prisma,
  });

  await app.ready();

  // Three humans on three different devices.
  sarah = await register('sarah', VIEWPORTS.phone);
  ahmed = await register('ahmed', VIEWPORTS.desktop);
  lina = await register('lina', VIEWPORTS.tablet);

  const group = await api(sarah.token, 'POST', '/groups', { name: 'Friday Night' });
  groupId = (group.json() as { id: string }).id;

  const invite = await api(sarah.token, 'POST', `/groups/${groupId}/invitations`, {
    expiresInHours: null,
    maxUses: null,
  });
  const code = (invite.json() as { code: string }).code;

  for (const player of [ahmed, lina]) await api(player.token, 'POST', '/join', { code });

  // Group-scoped: the defaults plus whatever this group wrote (D19).
  const themes = await api(sarah.token, 'GET', `/groups/${groupId}/themes`);
  const found = (themes.json() as { themes: SessionThemeDto[] }).themes.find(
    (theme) => theme.slug === 'anecdotes',
  );

  if (found === undefined) throw new Error('the seed did not produce the Anecdotes theme');
  anecdotes = found;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

/* ---- the game ------------------------------------------------------------------------------ */

describe('three players, one Anecdotes game', () => {
  let sessionId = '';

  it('lets the host punish a player before the game', async () => {
    await playAs(sarah, `/groups/${groupId}`, async () => {
      const ui = user();

      await screen.findByRole('heading', { name: 'Friday Night' });

      // Scoped to the roster, and asserted on the row rather than on loose text: the punishment
      // history below says "ahmed" and a level too, and matching that would prove nothing about
      // what the member row shows.
      const roster = () => within(screen.getByRole('region', { name: 'Players' }));
      const ahmedRow = (): HTMLElement => roster().getByText('ahmed').closest('li')!;

      const punishButton = (): HTMLElement =>
        within(ahmedRow()).getByRole('button', { name: 'Punish' });

      // Twice, so ahmed comes into the game on level 2 and answers three texts rather than one.
      for (let round = 0; round < 2; round += 1) {
        // The button stays disabled until the refetch behind the first punish settles. A person
        // cannot click through that either, so the test does not pretend to.
        await waitFor(() => {
          expect(punishButton()).toBeEnabled();
        });

        await ui.click(punishButton());

        await waitFor(() => {
          expect(ahmedRow()).toHaveTextContent(`${String(round + 1)} punishment`);
        });
      }

      // Level 2 in a three-player game means all three texts (D3 clamps it no further here).
      expect(ahmedRow()).toHaveTextContent('Answers 3');
    });
  });

  it('opens a game from the theme picker', async () => {
    await playAs(sarah, `/groups/${groupId}`, async () => {
      const ui = user();

      // The themes are simply on screen now: choosing one arms the button that starts the game.
      await ui.click(await screen.findByRole('radio', { name: /Anecdotes/ }));
      await ui.click(screen.getByRole('button', { name: /start game/i }));

      // The lobby is a route of its own, so arriving there proves the navigation as well.
      await gameOnScreen();
      expect(await screen.findByRole('heading', { name: /who is playing/i })).toBeVisible();
    });

    const live = await api(sarah.token, 'GET', `/groups/${groupId}/session`);
    sessionId = (live.json() as { session: { id: string } }).session.id;
    expect(sessionId).not.toBe('');
  });

  it('lets the other two join', async () => {
    for (const player of [ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        await user().click(await screen.findByRole('button', { name: /join the game/i }));
        await screen.findByText(/\(you\)/);
      });
    }
  });

  it('shows every player what the punishment will cost before they commit', async () => {
    await playAs(ahmed, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();

      const roster = within(await screen.findByRole('region', { name: /who is playing/i }));
      const row = roster.getByText('ahmed').closest('li');

      // D6: the load is a rule of the game, so it is stated up front rather than sprung later.
      // Asserted on the row, because the sentence is assembled from several elements.
      expect(row).toHaveTextContent('ahmed answers 3 texts · 2 punishments');
    });
  });

  it('starts once there are enough players', async () => {
    await playAs(sarah, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();
      await user().click(await screen.findByRole('button', { name: /start the game/i }));

      expect(
        await screen.findByRole('textbox', { name: anecdotes.writePrompt }),
      ).toBeInTheDocument();
    });
  });

  it('collects one anonymous text from each player', async () => {
    const texts: [Player, string][] = [
      [sarah, 'I once tried to bake a cake in a toaster.'],
      [ahmed, 'I got lost in a supermarket for two hours.'],
      [lina, 'I told my whole class I had a pet owl.'],
    ];

    for (const [player, body] of texts) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        await compose(anecdotes.writePrompt, body, /submit my text/i);

        // The composer going away is the phase-agnostic signal. The last player to submit never
        // sees the waiting card at all: their text completes the pile, distribution runs, and the
        // game is already dealing by the time the response lands.
        await waitFor(() => {
          expect(screen.queryAllByRole('textbox', { name: anecdotes.writePrompt })).toHaveLength(0);
        });
      });
    }
  });

  it('deals every text out, avoiding self-assignment wherever it can', async () => {
    const own = { sarah: /toaster/, ahmed: /supermarket/, lina: /pet owl/ };

    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        await screen.findAllByRole('textbox', { name: anecdotes.answerPrompt });

        // The received texts, read from the blocks that actually quote them — precise enough
        // that a match cannot come from a draft the player typed themselves.
        const received = [...document.querySelectorAll('blockquote')].map(
          (block) => block.textContent ?? '',
        );

        expect(received).toHaveLength(player === ahmed ? 3 : 1);

        if (player === ahmed) {
          // Three texts exist and ahmed owes three answers, so one of them is unavoidably his
          // own. D4 allows exactly this and no more: self-assignment is a soft penalty the
          // distributor eliminates whenever a legal swap exists, and here none does.
          expect(received.filter((text) => own.ahmed.test(text))).toHaveLength(1);
        } else {
          // With a demand of one and two other texts to choose from, it is always avoidable —
          // and avoided.
          expect(received.some((text) => own[player.name as 'sarah' | 'lina'].test(text))).toBe(
            false,
          );
        }

        // Whatever they were dealt, nothing on the screen says who wrote it — including the card
        // that is their own (D4: never surfaced, because surfacing it would leak authorship).
        expect(screen.queryByText(/^Written by |wrote this/i)).not.toBeInTheDocument();
      });
    }
  });

  it('collects an answer for every assignment', async () => {
    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();

        // ahmed works through a queue of three; the others have one card each.
        for (;;) {
          const remaining = screen.queryAllByRole('textbox', {
            name: anecdotes.answerPrompt,
          });

          if (remaining.length === 0) break;

          await compose(anecdotes.answerPrompt, `${player.name} says something.`, /submit answer/i);
          await waitFor(() => {
            expect(screen.queryAllByRole('textbox', { name: anecdotes.answerPrompt })).toHaveLength(
              remaining.length - 1,
            );
          });
        }
      });
    }
  });

  it('reaches the timeline on its own once the last answer lands', async () => {
    await playAs(sarah, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();

      // No host click needed: the phase advances when the work is done, so the table is not left
      // waiting on whoever happens to be host.
      expect(await screen.findByText(/toaster/)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: /move on to the results/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('shows an anonymous timeline with every answer under its text', async () => {
    await playAs(lina, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();

      expect(await screen.findAllByText('Written anonymously')).toHaveLength(3);
      expect(screen.queryByText(/^Written by /)).not.toBeInTheDocument();

      // Five answers were written, and all five are readable — including the two that landed on
      // the same text because ahmed was punished (D1).
      const answers = screen.getAllByText(/says something\./);
      expect(answers).toHaveLength(5);
    });
  });

  it('carries a discussion, anonymously and by name', async () => {
    await playAs(ahmed, `/groups/${groupId}/games/${sessionId}`, async () => {
      const ui = user();
      await gameOnScreen();

      const boxes = await screen.findAllByRole('textbox', { name: 'Add a comment' });
      await ui.type(boxes[0]!, 'That is hilarious.');
      await ui.click(screen.getAllByRole('button', { name: 'Post' })[0]!);
      await screen.findByText(/That is hilarious/);

      // The identity choice is per comment, made at post time, and never reversible (D17).
      await ui.click(screen.getAllByRole('radio', { name: 'ahmed' })[0]!);
      await ui.type(screen.getAllByRole('textbox', { name: 'Add a comment' })[0]!, 'I said that.');
      await ui.click(screen.getAllByRole('button', { name: 'Post' })[0]!);
      await screen.findByText(/I said that/);
    });

    await playAs(sarah, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();

      const anonymous = (await screen.findByText(/That is hilarious/)).closest('li');
      expect(anonymous).toHaveTextContent('Anonymous — That is hilarious.');

      const signed = screen.getByText(/I said that/).closest('li');
      expect(signed).toHaveTextContent('ahmed — I said that.');
    });
  });

  it('takes guesses without telling anyone whether they landed', async () => {
    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();

        const groups = await screen.findAllByRole('group', { name: 'Guess the author' });

        for (const guessGroup of groups) {
          const [first] = within(guessGroup).getAllByRole('button');
          await user().click(first!);
        }

        await waitFor(() => {
          expect(screen.getAllByText(/Saved\. You can still change it\./).length).toBeGreaterThan(
            0,
          );
        });

        // D9: correctness stays behind the reveal wall, because "you were right about ahmed" is
        // the author's name in a different sentence.
        expect(screen.queryByText(/that was right|that was wrong/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/who read the room/i)).not.toBeInTheDocument();
      });
    }
  });

  it('asks for the reveal vote, stating the rule first', async () => {
    await playAs(sarah, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();
      await user().click(await screen.findByRole('button', { name: /move to the reveal vote/i }));

      expect(await screen.findByText(/your choice is private/i)).toBeVisible();
      expect(
        screen.getByText(/one person saying no keeps the whole game anonymous/i),
      ).toBeVisible();

      // Three players is small enough that a refusal is inferable, and we say so beforehand.
      expect(screen.getByText(/narrows down who refused/i)).toBeVisible();
    });
  });

  it('keeps everyone anonymous when one player says no', async () => {
    const votes: [Player, RegExp][] = [
      [sarah, /reveal the authors/i],
      [ahmed, /reveal the authors/i],
      [lina, /keep us anonymous/i],
    ];

    for (const [player, button] of votes) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        await user().click(await screen.findByRole('button', { name: button }));
        await screen.findByText(/your vote is in|the group chose to stay anonymous/i);
      });
    }

    // Two of the three voted yes — and it makes no difference to any of them (D8).
    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();

        expect(await screen.findByText(/the group chose to stay anonymous/i)).toBeVisible();
        expect(screen.queryByText(/^Written by /)).not.toBeInTheDocument();
        expect(screen.queryByText(/who read the room/i)).not.toBeInTheDocument();
        // Nothing on the page hints at the split, or at who refused (D8a).
        expect(screen.queryByText(/2 of 3 wanted|voted no|refused/i)).not.toBeInTheDocument();
      });
    }
  });
});

describe('a second game, revealed by agreement', () => {
  let sessionId = '';

  it('plays through and reveals when everyone says yes', async () => {
    // Straight through this time — the punishment mechanic was proved above, and what is under
    // test here is the other half of the reveal rule.
    const created = await api(sarah.token, 'POST', `/groups/${groupId}/sessions`, {
      themeId: anecdotes.id,
    });
    sessionId = (created.json() as { id: string }).id;

    for (const player of [ahmed, lina])
      await api(player.token, 'POST', `/sessions/${sessionId}/join`);
    await api(sarah.token, 'POST', `/sessions/${sessionId}/start`);

    const texts: [Player, string][] = [
      [sarah, 'I still cannot whistle.'],
      [ahmed, 'I once missed a flight by a day.'],
      [lina, 'I have never seen the sea.'],
    ];

    for (const [player, body] of texts) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        await compose(anecdotes.writePrompt, body, /submit my text/i);
        await waitFor(() => {
          expect(screen.queryAllByRole('textbox', { name: anecdotes.writePrompt })).toHaveLength(0);
        });
      });
    }

    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        await compose(anecdotes.answerPrompt, `${player.name} replies.`, /submit answer/i);
        await waitFor(() => {
          expect(screen.queryAllByRole('textbox', { name: anecdotes.answerPrompt })).toHaveLength(
            0,
          );
        });
      });
    }

    await playAs(sarah, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();
      await screen.findByText(/whistle/);
    });

    // One guess each, so the leaderboard has something to say afterwards.
    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        const groups = await screen.findAllByRole('group', { name: 'Guess the author' });
        await user().click(within(groups[0]!).getAllByRole('button')[0]!);
        await screen.findByText(/Saved\./);
      });
    }

    await playAs(sarah, `/groups/${groupId}/games/${sessionId}`, async () => {
      await gameOnScreen();
      await user().click(await screen.findByRole('button', { name: /move to the reveal vote/i }));
      await screen.findByText(/your choice is private/i);
    });

    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();
        await user().click(await screen.findByRole('button', { name: /reveal the authors/i }));
        await screen.findByText(/your vote is in|everyone agreed/i);
      });
    }

    // Unanimous, so the names appear — for everyone, at the same moment, or not at all (D8).
    for (const player of [sarah, ahmed, lina]) {
      await playAs(player, `/groups/${groupId}/games/${sessionId}`, async () => {
        await gameOnScreen();

        expect(await screen.findByText(/everyone agreed/i)).toBeVisible();
        expect(screen.getByText('Written by sarah')).toBeVisible();
        expect(screen.getByText('Written by ahmed')).toBeVisible();
        expect(screen.getByText('Written by lina')).toBeVisible();
        expect(screen.getByText(/who read the room/i)).toBeVisible();
      });
    }
  });
});
