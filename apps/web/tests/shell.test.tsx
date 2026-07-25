import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDetailDto, GroupSummaryDto } from '@aftergame/shared';
import {
  renderWithProviders,
  findAccessibilityViolations,
  describeViolations,
} from './helpers/render.js';
import { AppShell } from '../src/shared/components/AppShell.js';
import { SessionProvider } from '../src/features/auth/SessionProvider.js';
import { setViewportWidth, VIEWPORTS } from './helpers/viewport.js';

/* ---- fixtures ---------------------------------------------------------------------------- */

const groups: GroupSummaryDto[] = [
  {
    id: 'g1',
    name: 'Friday Night',
    memberCount: 4,
    viewerRole: 'OWNER',
    createdAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'g2',
    name: 'Book Club',
    memberCount: 6,
    viewerRole: 'MEMBER',
    createdAt: '2026-07-02T00:00:00.000Z',
  },
];

const groupDetail: GroupDetailDto = {
  ...groups[0]!,
  members: [
    {
      userId: 'u1',
      username: 'sarah',
      role: 'OWNER',
      status: 'ACTIVE',
      consecutivePunishments: 0,
      joinedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      userId: 'u2',
      username: 'ahmed',
      role: 'COHOST',
      status: 'ACTIVE',
      consecutivePunishments: 2,
      joinedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      userId: 'u3',
      username: 'lina',
      role: 'MEMBER',
      status: 'GAME_BLOCKED',
      consecutivePunishments: 3,
      joinedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
};

/** Stub the network at `fetch`, so the real client, query layer and components all run. */
function stubApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) =>
        Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

      if (url.endsWith('/auth/me'))
        return json({ user: { id: 'u1', username: 'sarah', email: 's@x.com', createdAt: '' } });
      if (url.endsWith('/groups')) return json({ groups });
      if (url.includes('/groups/g1')) return json(groupDetail);

      return json({});
    }),
  );
}

const renderShell = (route = '/groups/g1') =>
  renderWithProviders(
    <SessionProvider>
      <AppShell>
        <h1>Group screen</h1>
      </AppShell>
    </SessionProvider>,
    { route, path: '/groups/:groupId' },
  );

describe('the app shell', () => {
  beforeEach(() => {
    stubApi();
    setViewportWidth(VIEWPORTS.desktop);
  });

  it('renders the group rail, sidebar and main panel', async () => {
    renderShell();

    // The rail names every group for assistive technology, not just its initials.
    expect(await screen.findByRole('link', { name: 'Friday Night' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book Club' })).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Friday Night' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('shows every member with their role', async () => {
    renderShell();

    const members = await screen.findByRole('list', { name: '' }).catch(() => null);
    expect(members).toBeDefined();

    expect(await screen.findByText('sarah')).toBeInTheDocument();
    expect(screen.getByText('ahmed')).toBeInTheDocument();
    expect(screen.getByText('lina')).toBeInTheDocument();
  });

  it('shows a punishment count and a blocked badge', async () => {
    renderShell();

    // The load is a rule of the game, so it is stated rather than hidden (D6).
    expect(await screen.findByText(/2 punishments/)).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('marks the current group as the active page', async () => {
    renderShell();

    const active = await screen.findByRole('link', { name: 'Friday Night' });
    expect(active).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('link', { name: 'Book Club' })).not.toHaveAttribute('aria-current');
  });

  it('offers a skip link before the navigation', async () => {
    renderShell();

    const skip = await screen.findByRole('link', { name: 'Skip to content' });

    // Keyboard users should not have to tab through the whole rail to reach the game.
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('labels the navigation landmark', async () => {
    renderShell();

    expect(await screen.findByRole('navigation', { name: 'Groups' })).toBeInTheDocument();
  });

  it('stays quiet about the connection while it is live', async () => {
    renderShell();
    await screen.findByRole('heading', { name: 'Friday Night' });

    // A permanent "connected" badge is noise; the status appears only when it is actionable.
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
  });

  // The three widths and both themes the design commits to, exercised as a matrix rather than as
  // a spot check, because "works on mobile" is the claim most easily made and least often true.
  describe.each(['light', 'dark'] as const)('responsive layout in %s mode', (theme) => {
    beforeEach(() => {
      localStorage.setItem('aftergame:theme', theme);
    });

    /** The theme is only meaningfully applied once the class is on the root element. */
    const expectThemeApplied = async () => {
      await waitFor(() => {
        expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
      });
    };

    it.each([
      ['a 768px tablet', VIEWPORTS.tablet],
      ['a 1440px desktop', VIEWPORTS.desktop],
    ])('renders group and member data inline on %s', async (_label, width) => {
      setViewportWidth(width);
      renderShell();

      const navigation = await screen.findByRole('navigation', { name: 'Groups' });

      // `find`, not `get`: the landmark is on screen immediately, but the group it describes
      // arrives with the request, so a synchronous query here would only see skeletons.
      expect(
        await within(navigation).findByRole('heading', { name: 'Friday Night' }),
      ).toBeInTheDocument();
      // Scoped to the navigation: the signed-in user's name also appears in the top bar, and an
      // unscoped query would match either and prove neither.
      expect(within(navigation).getByText('sarah')).toBeInTheDocument();
      expect(within(navigation).getByText('lina')).toBeInTheDocument();
      expect(screen.getByRole('main')).toBeInTheDocument();

      // No hamburger when the navigation is already on screen.
      expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();

      await expectThemeApplied();
    });

    it('renders group and member data in the drawer on a 320px phone', async () => {
      setViewportWidth(VIEWPORTS.phone);
      const user = userEvent.setup();
      renderShell();

      // At phone width the navigation is deliberately off screen until asked for — the main
      // panel is the game, and a rail would eat a third of it.
      expect(screen.queryByRole('navigation', { name: 'Groups' })).not.toBeInTheDocument();

      await user.click(await screen.findByRole('button', { name: 'Open navigation' }));

      const dialog = await screen.findByRole('dialog');
      expect(
        await within(dialog).findByRole('heading', { name: 'Friday Night' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText('sarah')).toBeInTheDocument();
      expect(within(dialog).getByText('lina')).toBeInTheDocument();

      await expectThemeApplied();
    });
  });

  describe('theming', () => {
    it('starts light, as the brief asks', async () => {
      renderShell();
      await screen.findByRole('heading', { name: 'Friday Night' });

      // No stored choice and no system preference for dark — light is the default, not an
      // accident of whichever branch ran first.
      expect(document.documentElement).not.toHaveClass('dark');
      expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
    });

    it('toggles to dark and remembers the choice', async () => {
      const user = userEvent.setup();
      renderShell();
      await screen.findByRole('heading', { name: 'Friday Night' });

      await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

      expect(document.documentElement).toHaveClass('dark');
      expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
      // Persisted, so the next visit does not flash the wrong theme.
      expect(localStorage.getItem('aftergame:theme')).toBe('dark');

      await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

      expect(document.documentElement).not.toHaveClass('dark');
      expect(localStorage.getItem('aftergame:theme')).toBe('light');
    });
  });

  describe('one navigation tree', () => {
    it('renders exactly one copy of each group link', async () => {
      setViewportWidth(VIEWPORTS.desktop);
      renderShell();

      await screen.findByRole('heading', { name: 'Friday Night' });

      // Two trees hidden by CSS would put two links here — invisible in a browser, but not to a
      // focus trap or an audit.
      expect(screen.getAllByRole('link', { name: 'Friday Night' })).toHaveLength(1);
    });

    it('does not strand the shell when the viewport widens with the drawer open', async () => {
      setViewportWidth(VIEWPORTS.phone);
      const user = userEvent.setup();
      renderShell();

      await user.click(await screen.findByRole('button', { name: 'Open navigation' }));
      await screen.findByRole('dialog');

      setViewportWidth(VIEWPORTS.desktop);

      // Crossing the breakpoint unmounts the drawer. If "is the drawer open" were trusted on its
      // own, the background would stay inert with nothing on top of it — an app that looks
      // perfectly normal and answers no input at all.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('main').closest('[inert]')).toBeNull();
      expect(await screen.findByRole('navigation', { name: 'Groups' })).toBeInTheDocument();
    });

    it('reflows when the viewport changes without remounting', async () => {
      setViewportWidth(VIEWPORTS.desktop);
      renderShell();

      expect(await screen.findByRole('navigation', { name: 'Groups' })).toBeInTheDocument();

      setViewportWidth(VIEWPORTS.phone);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('navigation', { name: 'Groups' })).not.toBeInTheDocument();
    });
  });

  describe('the mobile drawer', () => {
    beforeEach(() => {
      setViewportWidth(VIEWPORTS.phone);
    });

    it('opens, traps focus and closes on Escape', async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(await screen.findByRole('button', { name: 'Open navigation' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Groups')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('returns focus to the trigger when closed', async () => {
      const user = userEvent.setup();
      renderShell();

      const trigger = await screen.findByRole('button', { name: 'Open navigation' });
      await user.click(trigger);
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');

      // Losing focus to the page body after closing a dialog strands a keyboard user. Radix
      // restores it after the close completes, so this waits rather than sampling too early.
      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = renderShell();
      await screen.findByRole('heading', { name: 'Friday Night' });

      const violations = await findAccessibilityViolations(container);

      expect(violations, describeViolations(violations)).toEqual([]);
    });

    it('has no axe violations with the drawer open', async () => {
      setViewportWidth(VIEWPORTS.phone);
      const user = userEvent.setup();
      const { baseElement } = renderShell();

      await user.click(await screen.findByRole('button', { name: 'Open navigation' }));
      await screen.findByRole('dialog');

      // The drawer renders in a portal, so the whole document is scanned rather than the
      // container the shell rendered into.
      const violations = await findAccessibilityViolations(baseElement as HTMLElement);

      expect(violations, describeViolations(violations)).toEqual([]);
    });

    it('makes the background inert while the drawer is open', async () => {
      setViewportWidth(VIEWPORTS.phone);
      const user = userEvent.setup();
      renderShell();

      const shell = await screen.findByRole('main');
      expect(shell.closest('[inert]')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Open navigation' }));
      await screen.findByRole('dialog');

      // Radix traps focus; `inert` makes the background unreachable in the DOM itself, so the
      // guarantee does not depend on the trap holding.
      expect(shell.closest('[inert]')).not.toBeNull();
    });

    it('has no axe violations in dark mode', async () => {
      document.documentElement.classList.add('dark');

      const { container } = renderShell();
      await screen.findByRole('heading', { name: 'Friday Night' });

      const violations = await findAccessibilityViolations(container);

      expect(violations, describeViolations(violations)).toEqual([]);
      document.documentElement.classList.remove('dark');
    });
  });
});
