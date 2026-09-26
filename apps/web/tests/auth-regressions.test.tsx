import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './helpers/render.js';
import LoginPage from '../src/features/auth/LoginPage.js';
import { SessionProvider } from '../src/features/auth/SessionProvider.js';

describe('French authentication and submission', () => {
  it('sends one request for simultaneous submissions and shows a French credential error', async () => {
    let rejectLogin: (() => void) | undefined;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/me')) return Promise.resolve(new Response(JSON.stringify({ code: 'UNAUTHENTICATED', status: 401, title: 'Anonymous' }), { status: 401 }));
      return new Promise<Response>(resolve => { rejectLogin = () => resolve(new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS', status: 401, title: 'Invalid credentials' }), { status: 401 })); });
    });
    vi.stubGlobal('fetch', fetch);
    localStorage.setItem('aftergame:locale', 'en');
    renderWithProviders(<SessionProvider><LoginPage /></SessionProvider>, { fixedLocale: 'fr' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/e-mail/i), 'person@example.com');
    await user.type(screen.getByLabelText(/^mot de passe/i, { selector: 'input' }), 'wrong');
    const form = screen.getByRole('button', { name: 'Se connecter' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/login'))).toHaveLength(1);
    rejectLogin?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled());
    expect(document.documentElement.lang).toBe('fr');
    expect(screen.getByText(/incorrect/i)).toBeInTheDocument();
  });

  it('renders shared validation errors in French', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))));
    renderWithProviders(<SessionProvider><LoginPage /></SessionProvider>, { fixedLocale: 'fr' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(screen.getByText('Saisissez votre adresse e-mail')).toBeInTheDocument();
    expect(screen.getByText('Saisissez votre mot de passe')).toBeInTheDocument();
  });
});
