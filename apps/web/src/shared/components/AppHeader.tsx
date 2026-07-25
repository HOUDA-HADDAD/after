import { Link } from 'react-router';
import { useSession } from '../../features/auth/SessionProvider.js';
import { useTheme } from '../hooks/useTheme.js';

/**
 * The header every signed-in screen shares.
 *
 * Phase 7 replaces this with the real Slack-style shell; it exists now so the two group screens
 * cannot drift, and so sign-out lives in exactly one place.
 */
export function AppHeader() {
  const { state, logout } = useSession();
  const { theme, toggle } = useTheme();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
      <Link to="/" className="text-lg font-semibold tracking-tight">
        Aftergame
      </Link>

      <div className="flex items-center gap-3 text-sm">
        {state.status === 'authenticated' && (
          <span className="text-[var(--color-ink-muted)]">{state.user.username}</span>
        )}

        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 transition-colors hover:border-[var(--color-accent)]"
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>

        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 transition-colors hover:border-[var(--color-accent)]"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
