import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { GroupDetailDto, GroupSummaryDto } from '@aftergame/shared';
import { renderWithProviders } from './helpers/render.js';
import { currentSocket } from './helpers/socket.js';
import { AppShell } from '../src/shared/components/AppShell.js';
import { SessionProvider } from '../src/features/auth/SessionProvider.js';
import { setViewportWidth, VIEWPORTS } from './helpers/viewport.js';

/* ---- a fixture the test can change out from under the client ------------------------------- */

let groups: GroupSummaryDto[];
let groupDetail: GroupDetailDto;

function resetFixtures(): void {
  groups = [
    {
      id: 'g1',
      name: 'Friday Night',
      memberCount: 2,
      viewerRole: 'OWNER',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ];

  groupDetail = {
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
        role: 'MEMBER',
        status: 'ACTIVE',
        consecutivePunishments: 0,
        joinedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
  };
}

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

const renderShell = () =>
  renderWithProviders(
    <SessionProvider>
      <AppShell>
        <h1>Group screen</h1>
      </AppShell>
    </SessionProvider>,
    { route: '/groups/g1', path: '/groups/:groupId' },
  );

/** Someone joins the group while the client is offline. */
function membershipChangesWhileAway(): void {
  groupDetail = {
    ...groupDetail,
    memberCount: 3,
    members: [
      ...groupDetail.members,
      {
        userId: 'u3',
        username: 'lina',
        role: 'MEMBER',
        status: 'ACTIVE',
        consecutivePunishments: 0,
        joinedAt: '2026-07-02T00:00:00.000Z',
      },
    ],
  };
}

describe('the realtime connection', () => {
  beforeEach(() => {
    resetFixtures();
    stubApi();
    setViewportWidth(VIEWPORTS.desktop);
  });

  it('subscribes to the group it is showing', async () => {
    renderShell();
    await screen.findByRole('heading', { name: 'Friday Night' });

    currentSocket().serverConnect();

    expect(currentSocket().emitted).toContainEqual({ event: 'subscribe:group', args: ['g1'] });
  });

  it('says nothing while live and reports the drop when it happens', async () => {
    renderShell();
    await screen.findByRole('heading', { name: 'Friday Night' });

    currentSocket().serverConnect();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    currentSocket().serverDisconnect();

    // The one time the connection is worth a pixel is when it is not working.
    expect(await screen.findByRole('status')).toHaveTextContent('Reconnecting…');
  });

  it('reconnects and resyncs without a page reload', async () => {
    renderShell();
    await screen.findByRole('heading', { name: 'Friday Night' });

    const socket = currentSocket();
    socket.serverConnect();

    // Hold on to live DOM nodes. If the app recovered by reloading or remounting, these would be
    // replaced rather than updated — which is precisely what the criterion rules out.
    const main = screen.getByRole('main');
    const heading = screen.getByRole('heading', { name: 'Friday Night' });

    socket.serverDisconnect();
    expect(await screen.findByRole('status')).toHaveTextContent('Reconnecting…');

    // The world moves on while the client is away, and the client has no way to know what it
    // missed — which is the whole reason a reconnect has to refetch rather than reason.
    membershipChangesWhileAway();
    expect(screen.queryByText('lina')).not.toBeInTheDocument();

    const mark = socket.emitted.length;
    socket.serverConnect();

    // Resync: the data the client missed is on screen…
    expect(await screen.findByText('lina')).toBeInTheDocument();
    // …the room was re-joined, since a reconnected socket is in no rooms…
    expect(socket.emittedSince(mark)).toContainEqual({
      event: 'subscribe:group',
      args: ['g1'],
    });
    // …the status went quiet again…
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    // …and the page it happened on is the same page. Same nodes, same socket, no remount.
    expect(screen.getByRole('main')).toBe(main);
    expect(screen.getByRole('heading', { name: 'Friday Night' })).toBe(heading);
    expect(currentSocket()).toBe(socket);
    expect(socket.closed).toBe(false);
  });

  it('refreshes a group when the server says it changed', async () => {
    renderShell();
    await screen.findByRole('heading', { name: 'Friday Night' });

    const socket = currentSocket();
    socket.serverConnect();

    membershipChangesWhileAway();
    socket.deliver('group:changed', { groupId: 'g1' });

    // The event carries an id and nothing else; the data comes back through the normal read path,
    // so it is projected and authorized exactly as a page load would be (D14).
    expect(await screen.findByText('lina')).toBeInTheDocument();
  });
});
