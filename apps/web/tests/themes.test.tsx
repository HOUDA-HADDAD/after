import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupThemeDto } from '@aftergame/shared';
import {
  renderWithProviders,
  findAccessibilityViolations,
  describeViolations,
} from './helpers/render.js';
import { ThemeManager } from '../src/features/groups/ThemeManager.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CONFESSIONS: GroupThemeDto = {
  id: 't-custom',
  slug: 'confessions',
  name: 'Confessions',
  description: 'Own up to something.',
  writePrompt: 'Write a confession',
  writePlaceholder: 'I never actually…',
  answerPrompt: 'React honestly',
  icon: '🙊',
  supportsComments: true,
  supportsAuthorGuess: false,
  usedByGames: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
};

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

function stub(themes: GroupThemeDto[]): Recorded[] {
  const calls: Recorded[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body));

      calls.push({ method: init?.method ?? 'GET', url, body });

      if (url.includes('/themes/custom')) {
        return Promise.resolve(new Response(JSON.stringify({ themes }), { status: 200 }));
      }

      return Promise.resolve(new Response(JSON.stringify(CONFESSIONS), { status: 201 }));
    }),
  );

  return calls;
}

const render = (canManage = true) =>
  renderWithProviders(<ThemeManager groupId="g1" canManage={canManage} />);

describe('group themes', () => {
  it('invites a host to write the first one', async () => {
    stub([]);
    render();

    expect(await screen.findByText(/no themes of your own yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /write a theme/i })).toBeInTheDocument();
  });

  it('tells a plain member whose job it is instead of offering a dead button', async () => {
    stub([]);
    render(false);

    expect(await screen.findByText(/a host can write themes/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write a theme/i })).not.toBeInTheDocument();
  });

  it('lists what the group wrote', async () => {
    stub([CONFESSIONS]);
    render();

    expect(await screen.findByText('Confessions')).toBeInTheDocument();
    expect(screen.getByText('Own up to something.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Confessions' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete Confessions' })).toBeEnabled();
  });

  it('sends the whole theme when one is written', async () => {
    const user = userEvent.setup();
    const calls = stub([]);
    render();

    await user.click(await screen.findByRole('button', { name: /write a theme/i }));

    await user.type(screen.getByLabelText('Name'), 'Confessions');
    await user.clear(screen.getByLabelText('Icon'));
    await user.type(screen.getByLabelText('Icon'), '🙊');
    await user.type(screen.getByLabelText('Description'), 'Own up to something.');
    await user.type(screen.getByLabelText('Write prompt'), 'Write a confession');
    await user.type(screen.getByLabelText('Answer prompt'), 'React honestly');

    await user.click(screen.getByRole('button', { name: /add it to the picker/i }));

    const posted = [...calls].reverse().find((call) => call.method === 'POST');

    expect(posted?.body).toMatchObject({
      name: 'Confessions',
      icon: '🙊',
      writePrompt: 'Write a confession',
      answerPrompt: 'React honestly',
      // The capability flags are the group's to choose too (D15, D19).
      supportsComments: true,
      supportsAuthorGuess: true,
    });
  });

  it('explains why a theme in use cannot be touched, with the number', async () => {
    stub([{ ...CONFESSIONS, usedByGames: 2 }]);
    render();

    const row = (await screen.findByText('Confessions')).closest('li');

    // Greying the buttons out and leaving people to guess is the failure this avoids: the banner
    // is pinned all game, so a theme a game is using is frozen until that game is deleted.
    expect(within(row!).getByText(/2 games use this theme/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Confessions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Confessions' })).toBeDisabled();
  });

  it('deletes one nothing is using', async () => {
    const user = userEvent.setup();
    const calls = stub([CONFESSIONS]);
    render();

    await user.click(await screen.findByRole('button', { name: 'Delete Confessions' }));

    const deleted = calls.find((call) => call.method === 'DELETE');
    expect(deleted?.url).toContain('/groups/g1/themes/t-custom');
  });

  it('edits in place rather than making a second one', async () => {
    const user = userEvent.setup();
    const calls = stub([CONFESSIONS]);
    render();

    await user.click(await screen.findByRole('button', { name: 'Edit Confessions' }));

    // The form opens on the existing values — an edit form that starts blank is a delete and a
    // retype wearing a different label.
    expect(screen.getByLabelText('Name')).toHaveValue('Confessions');
    expect(screen.getByLabelText('Write prompt')).toHaveValue('Write a confession');

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Confessions, revised');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain('/groups/g1/themes/t-custom');
    expect(put?.body).toMatchObject({ name: 'Confessions, revised' });
  });

  it('has no axe violations, list or form', async () => {
    const user = userEvent.setup();
    stub([CONFESSIONS]);
    const { container } = render();

    await screen.findByText('Confessions');
    let violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Edit Confessions' }));
    violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});
