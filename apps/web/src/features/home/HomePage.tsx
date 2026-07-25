import { useState } from 'react';
import { useSession } from '../auth/SessionProvider.js';
import { useTheme } from '../../shared/hooks/useTheme.js';
import { messageFor } from '../../shared/lib/error-copy.js';

/**
 * Placeholder landing screen for a signed-in user.
 *
 * Phase 3 replaces this with the group list; it exists now to give the protected route somewhere
 * to land and to exercise sign-out end to end.
 */
export default function HomePage() {
  const { state, logout } = useSession();
  const { theme, toggle } = useTheme();
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'authenticated') return null;

  const handleLogout = async () => {
    try {
      await logout();
    } catch (caught) {
      setError(messageFor(caught));
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Aftergame</h1>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            Signed in as{' '}
            <span className="font-medium text-[var(--color-ink)]">{state.user.username}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm transition-colors hover:border-[var(--color-accent)]"
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
        <h2 className="text-sm font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          Your groups
        </h2>
        <p className="mt-2 text-[var(--color-ink-muted)]">
          Groups arrive in Phase 3. You will create one here, or join a friend&rsquo;s with a room
          code.
        </p>
      </section>

      <footer className="flex items-center justify-between gap-4 text-sm">
        <span className="text-[var(--color-ink-muted)]">
          Phase 2 — authentication. See <code className="font-mono">docs/06-roadmap.md</code>.
        </span>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 transition-colors hover:border-[var(--color-accent)]"
        >
          Sign out
        </button>
      </footer>

      <div aria-live="polite">
        {error !== null && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </main>
  );
}
