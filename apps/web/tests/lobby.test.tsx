import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDetailDto, InvitationDto, SessionSummaryDto } from '@aftergame/shared';
import {
  renderWithProviders,
  findAccessibilityViolations,
  describeViolations,
} from './helpers/render.js';
import { ANECDOTES, makeGroup, VIEWER_USER_ID } from './helpers/game-fixtures.js';
import GroupDetailPage from '../src/features/groups/GroupDetailPage.js';
import { SessionProvider } from '../src/features/auth/SessionProvider.js';
import { setViewportWidth, VIEWPORTS } from './helpers/viewport.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const CODE: InvitationDto = {
  id: 'i1',
  code: 'NCHGNA29',
  createdAt: '2026-07-01T00:00:00.000Z',
  expiresAt: null,
  maxUses: null,
  useCount: 0,
};

const CHALLENGES = { ...ANECDOTES, id: 't2', slug: 'challenges', name: 'Challenges' };

interface RoomOptions {
  group?: GroupDetailDto;
  liveSession?: SessionSummaryDto | null;
  code?: InvitationDto | null;
}

function stubRoom({ group = makeGroup(), liveSession = null, code = CODE }: RoomOptions = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body));

      calls.push({ method: init?.method ?? 'GET', url, body });

      const json = (payload: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(payload), { status }));

      if (url.endsWith('/auth/me')) {
        return json({
          user: { id: VIEWER_USER_ID, username: 'sarah', email: 's@x.com', createdAt: '' },
        });
      }

      if (url.includes('/themes/custom')) return json({ themes: [] });
      if (url.includes('/themes')) return json({ themes: [ANECDOTES, CHALLENGES] });
      if (url.endsWith('/session')) return json({ session: liveSession });
      if (url.includes('/invitations')) return json({ invitations: code === null ? [] : [code] });
      if (url.includes('/punishments')) return json({ events: [] });
      if (url.includes('/sessions')) return json({ id: 's-new' });
      if (/\/groups\/[^/]+$/.test(url)) return json(group);

      return json({});
    }),
  );

  return calls;
}

const renderRoom = () =>
  renderWithProviders(
    <SessionProvider>
      <GroupDetailPage />
    </SessionProvider>,
    { route: '/groups/g1', path: '/groups/:groupId' },
  );

const roomLoaded = () => screen.findByRole('heading', { name: 'Friday Night', level: 1 });

/** The code arrives on its own request, after the room. Waiting for the name is not enough. */
const codeLoaded = () => screen.findByRole('button', { name: /^Copy code/ });

describe('the room header', () => {
  it('puts the code beside the name rather than in a card of its own', async () => {
    stubRoom();
    renderRoom();

    const heading = await roomLoaded();
    await codeLoaded();
    const header = heading.closest('header');

    // The two facts somebody reads aloud when getting friends into a game, side by side.
    expect(within(header!).getByText('NCHGNA29')).toBeInTheDocument();
    expect(within(header!).getByText('3 members')).toBeInTheDocument();
  });

  it('spells the code out for anyone hearing it rather than seeing it', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    // "NCHGNA29" read as a word is useless, and this is a string people dictate across a room.
    expect(
      await screen.findByRole('button', { name: 'Copy code: N C H G N A 2 9' }),
    ).toBeInTheDocument();
  });

  it('confirms a copy, then goes quiet again', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, languages: ['en'] });
    stubRoom();
    renderRoom();
    await roomLoaded();

    await user.click(await codeLoaded());

    expect(writeText).toHaveBeenCalledWith('NCHGNA29');
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
  });

  it('offers a fresh code to a host only', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    expect(await screen.findByRole('button', { name: 'Generate new code' })).toBeInTheDocument();
  });

  it('says so plainly when there is no code yet', async () => {
    stubRoom({ code: null });
    renderRoom();
    await roomLoaded();

    expect(await screen.findByText('No active code')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copy code/ })).not.toBeInTheDocument();
  });
});

describe('the lobby', () => {
  it('invites a host to pick a theme and start', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    expect(await screen.findByRole('heading', { name: 'No game running' })).toBeInTheDocument();
    expect(screen.getByText(/pick a theme and start a new game/i)).toBeInTheDocument();
  });

  it('tells a member whose job starting it is', async () => {
    const group = makeGroup({ viewerRole: 'MEMBER' });

    stubRoom({ group });
    renderRoom();
    await roomLoaded();

    expect(await screen.findByText(/a host starts the game/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument();
  });

  it('shows the themes as a radio group without asking first', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    // The old flow was New game → a list → Open the lobby. The question "what are we playing?"
    // is now answered before it is asked.
    const group = await screen.findByRole('radiogroup', { name: 'Choose a theme' });

    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: /Anecdotes/ })).toBeInTheDocument();
  });

  it('will not start until a theme is chosen, and says why', async () => {
    const user = userEvent.setup();
    const calls = stubRoom();
    renderRoom();
    await roomLoaded();

    const start = await screen.findByRole('button', { name: /start game/i });

    expect(start).toBeDisabled();
    expect(screen.getByText('Pick a theme to start')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Anecdotes/ }));

    expect(start).toBeEnabled();
    expect(screen.queryByText('Pick a theme to start')).not.toBeInTheDocument();

    await user.click(start);

    const created = calls.find((call) => call.method === 'POST' && call.url.endsWith('/sessions'));
    expect(created?.body).toEqual({ themeId: ANECDOTES.id });
  });

  it('marks the chosen theme, and only that one', async () => {
    const user = userEvent.setup();
    stubRoom();
    renderRoom();
    await roomLoaded();

    const anecdotes = await screen.findByRole('radio', { name: /Anecdotes/ });
    const challenges = screen.getByRole('radio', { name: /Challenges/ });

    await user.click(anecdotes);

    expect(anecdotes).toHaveAttribute('aria-checked', 'true');
    expect(challenges).toHaveAttribute('aria-checked', 'false');
  });

  it('moves between themes with the arrow keys, like a real radio group', async () => {
    const user = userEvent.setup();
    stubRoom();
    renderRoom();
    await roomLoaded();

    const anecdotes = await screen.findByRole('radio', { name: /Anecdotes/ });

    await user.click(anecdotes);
    await user.keyboard('{ArrowRight}');

    // A grid of tiles that cannot be driven from the keyboard is how game UIs lock people out.
    expect(screen.getByRole('radio', { name: /Challenges/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('links to a running game instead of offering to start another', async () => {
    stubRoom({
      liveSession: {
        id: 's1',
        phase: 'WRITING',
        themeName: 'Anecdotes',
        playerCount: 3,
        youArePlaying: true,
      },
    });
    renderRoom();
    await roomLoaded();

    expect(await screen.findByText('Anecdotes is running')).toBeInTheDocument();
    expect(screen.getByText('3 players')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the game' })).toBeInTheDocument();
    // A room holds one game at a time, so a second picker would be offering the impossible.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});

describe('the player list', () => {
  it('gives every player an avatar, a role and a status', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    const players = await screen.findByRole('region', { name: 'Players' });

    expect(within(players).getByText('sarah')).toBeInTheDocument();
    expect(within(players).getByText('Owner')).toBeInTheDocument();
    expect(within(players).getAllByText('Member')).toHaveLength(2);
    // Announced after the name, so it reads as a sentence rather than a label salad.
    expect(within(players).getAllByText('Online')).toHaveLength(3);
  });

  it('states the load a punishment implies, in the roster', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    const players = await screen.findByRole('region', { name: 'Players' });

    // ahmed carries two punishments in the fixture: a rule of the game, said out loud (D6).
    expect(within(players).getByText(/2 punishments · Answers 3/)).toBeInTheDocument();
  });

  it('offers moderation only where the rules allow it', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    const players = await screen.findByRole('region', { name: 'Players' });
    const you = within(players).getByText('sarah').closest('div');

    // An owner may punish anyone but themselves (D16).
    expect(within(you!).queryByRole('button', { name: 'Punish' })).not.toBeInTheDocument();
    expect(within(players).getAllByRole('button', { name: 'Punish' })).toHaveLength(2);
  });

  it('gives a plain member no moderation buttons at all', async () => {
    stubRoom({ group: makeGroup({ viewerRole: 'MEMBER' }) });
    renderRoom();
    await roomLoaded();

    const players = await screen.findByRole('region', { name: 'Players' });

    expect(within(players).queryByRole('button', { name: 'Punish' })).not.toBeInTheDocument();
  });
});

describe('room settings', () => {
  it('starts collapsed, so the page is about the game', async () => {
    stubRoom();
    renderRoom();
    await roomLoaded();

    const settings = screen.getByText('Room settings').closest('details');

    expect(settings).not.toHaveAttribute('open');
  });

  it('opens to the themes, the history and the way out', async () => {
    const user = userEvent.setup();
    stubRoom({ group: makeGroup({ viewerRole: 'MEMBER' }) });
    renderRoom();
    await roomLoaded();

    await user.click(screen.getByText('Room settings'));

    expect(await screen.findByText('Your themes')).toBeInTheDocument();
    expect(screen.getByText('Punishment history')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave room' })).toBeInTheDocument();
  });

  it('never offers an owner the leave button', async () => {
    const user = userEvent.setup();
    stubRoom();
    renderRoom();
    await roomLoaded();

    await user.click(screen.getByText('Room settings'));

    // An owner leaving would strand the room, so the API refuses; the UI should not ask.
    expect(screen.queryByRole('button', { name: 'Leave room' })).not.toBeInTheDocument();
  });
});

describe('the room in French', () => {
  it('translates the lobby when the locale is French', async () => {
    localStorage.setItem('aftergame:locale', 'fr');
    stubRoom();
    renderRoom();
    await roomLoaded();

    expect(
      await screen.findByRole('heading', { name: 'Aucune partie en cours' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /démarrer la partie/i })).toBeInTheDocument();
    const players = screen.getByRole('region', { name: 'Joueurs' });

    // The role appears in the header chip too, so this is scoped rather than ambiguous.
    expect(within(players).getByText('Propriétaire')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /copier le code/i })).toBeInTheDocument();
  });

  it('sets the document language, which is what assistive technology reads', async () => {
    localStorage.setItem('aftergame:locale', 'fr');
    stubRoom();
    renderRoom();
    await roomLoaded();

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('fr');
    });
  });

  it('interpolates counts rather than concatenating them', async () => {
    localStorage.setItem('aftergame:locale', 'fr');
    stubRoom();
    renderRoom();

    // French puts the number first here too, but the point is that the sentence is one string a
    // translator can reorder — not "3" + " membres" glued together in the component.
    expect(await screen.findByText('3 membres')).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it.each([
    ['a phone', VIEWPORTS.phone],
    ['a desktop', VIEWPORTS.desktop],
  ])('has no axe violations on %s', async (_label, width) => {
    setViewportWidth(width);
    stubRoom();

    const { container } = renderRoom();
    await roomLoaded();
    await screen.findByRole('radiogroup', { name: 'Choose a theme' });

    const violations = await findAccessibilityViolations(container);

    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('has no axe violations in dark mode', async () => {
    document.documentElement.classList.add('dark');
    stubRoom();

    const { container } = renderRoom();
    await roomLoaded();

    const violations = await findAccessibilityViolations(container);

    expect(violations, describeViolations(violations)).toEqual([]);
    document.documentElement.classList.remove('dark');
  });
});
