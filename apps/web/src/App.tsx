import { useEffect, useState } from 'react';
import { TEXT_MAX_LENGTH, MIN_PLAYERS_PER_SESSION } from '@aftergame/shared';
import { useTheme } from './shared/hooks/useTheme.js';

type ApiStatus =
  | { state: 'loading' }
  | { state: 'ready'; uptimeSeconds: number }
  | { state: 'error'; message: string };

/**
 * Phase 0 shell.
 *
 * Its job is to prove the wiring end to end: the SPA builds, imports the shared contract package,
 * reaches the API through the single-origin proxy, and themes correctly in light and dark.
 * The real app shell lands in Phase 7.
 */
export default function App() {
  const { theme, toggle } = useTheme();
  const [status, setStatus] = useState<ApiStatus>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetch('/healthz', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API responded ${response.status}`);
        return response.json() as Promise<{ status: string; uptimeSeconds: number }>;
      })
      .then((body) => {
        setStatus({ state: 'ready', uptimeSeconds: body.uptimeSeconds });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus({
          state: 'error',
          message: error instanceof Error ? error.message : 'Could not reach the API',
        });
      });

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Aftergame</h1>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            An anonymous party game for private groups of friends.
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

      <section
        aria-live="polite"
        className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5"
      >
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
          API connection
        </h2>

        <p className="mt-2 text-lg">
          {status.state === 'loading' && 'Checking…'}
          {status.state === 'ready' && `Connected — up ${status.uptimeSeconds}s`}
          {status.state === 'error' && `Not reachable — ${status.message}`}
        </p>

        {status.state === 'error' && (
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            Start the API with <code className="font-mono">pnpm dev</code>, or check that it is
            listening on port 3000.
          </p>
        )}
      </section>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
          Shared contract
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-[var(--color-ink-muted)]">Max text length</dt>
          <dd className="text-right font-mono">{TEXT_MAX_LENGTH}</dd>
          <dt className="text-[var(--color-ink-muted)]">Minimum players</dt>
          <dd className="text-right font-mono">{MIN_PLAYERS_PER_SESSION}</dd>
        </dl>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          These come from <code className="font-mono">@aftergame/shared</code>, the same module the
          API validates with — so a limit can never mean two things in two layers.
        </p>
      </section>

      <footer className="text-sm text-[var(--color-ink-muted)]">
        Phase 0 — foundations. See <code className="font-mono">docs/06-roadmap.md</code>.
      </footer>
    </main>
  );
}
