import type { ReactNode } from 'react';

/**
 * Chrome for the two screens outside the app shell.
 *
 * Sign-in and sign-up are the only pages a signed-out visitor sees, so they get their own centred
 * layout rather than an empty version of the shell.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-canvas)] px-6 py-12 text-[var(--color-ink)]">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Aftergame</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            An anonymous party game for private groups of friends.
          </p>
        </header>

        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="mt-1 mb-5 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
          {children}
        </div>

        <p className="text-center text-sm text-[var(--color-ink-muted)]">{footer}</p>
      </div>
    </main>
  );
}
