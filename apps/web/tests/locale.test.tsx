import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDetailDto, GroupSummaryDto } from '@aftergame/shared';
import { renderWithProviders } from './helpers/render.js';
import { AppShell } from '../src/shared/components/AppShell.js';
import { SessionProvider } from '../src/features/auth/SessionProvider.js';
import { setViewportWidth, VIEWPORTS } from './helpers/viewport.js';
import { en, fr } from '../src/shared/i18n/translations.js';

/* ---- fixtures ---------------------------------------------------------------------------- */

const groups: GroupSummaryDto[] = [
  {
    id: 'g1',
    name: 'Friday Night',
    memberCount: 4,
    viewerRole: 'OWNER',
    createdAt: '2026-07-01T00:00:00.000Z',
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
  ],
};

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
        <h1>Room screen</h1>
      </AppShell>
    </SessionProvider>,
    { route: '/groups/g1', path: '/groups/:groupId' },
  );

/**
 * The other half of the translation guarantee.
 *
 * `i18n.test.ts` proves every string reached the dictionary. That is necessary and not sufficient:
 * a component can read the dictionary and still be wired so the choice never takes effect. These
 * tests drive the switcher the way a person does and assert the app comes back in French.
 */
describe('choosing a language', () => {
  beforeEach(() => {
    stubApi();
    setViewportWidth(VIEWPORTS.desktop);
    // No stored choice and an English browser, so the default is not doing the work for us.
    localStorage.removeItem('aftergame:locale');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB', 'en']);
  });

  it('renders the app in French and back again', async () => {
    const user = userEvent.setup();
    renderShell();

    const navigation = await screen.findByRole('navigation', { name: en['shell.rooms'] });
    expect(navigation).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: en['language.label'] }), 'fr');

    // The landmark is the load-bearing case: its name comes from a prop, not from children, so a
    // component that hard-codes it would still look translated on screen and read English aloud.
    expect(await screen.findByRole('navigation', { name: fr['shell.rooms'] })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: fr['players.title'] })).toBeInTheDocument();

    // The switcher itself is now labelled in the language it just switched to.
    await user.selectOptions(screen.getByRole('combobox', { name: fr['language.label'] }), 'en');

    expect(await screen.findByRole('navigation', { name: en['shell.rooms'] })).toBeInTheDocument();
  });

  it('remembers the choice and tells the browser about it', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.selectOptions(
      await screen.findByRole('combobox', { name: en['language.label'] }),
      'fr',
    );

    await waitFor(() => {
      // Without `lang`, a screen reader keeps reading French with an English voice, and browser
      // translation offers to translate a page that is already in the reader's language.
      expect(document.documentElement.lang).toBe('fr');
    });

    // Persisted, so the next visit does not start over in English.
    expect(localStorage.getItem('aftergame:locale')).toBe('fr');
  });

  it('follows the browser when nobody has chosen yet', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'fr']);

    renderShell();

    // Arriving already translated is the difference between an app that is translated and one
    // that is translatable. `fr-FR` has to match the `fr` dictionary — the region is not the
    // language.
    expect(await screen.findByRole('navigation', { name: fr['shell.rooms'] })).toBeInTheDocument();
  });
});
