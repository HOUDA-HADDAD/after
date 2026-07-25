import type { ReactNode } from 'react';

/**
 * Shared chrome for the sign-in and sign-up screens.
 *
 * Phase 7 replaces this with the real design system; until then it exists so the two auth screens
 * cannot drift apart, and so accessibility (labels, `aria-invalid`, error association, focus
 * order) is written once rather than twice.
 */

const CARD =
  'w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 shadow-sm';

export function AuthCard({
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
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Aftergame</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            An anonymous party game for private groups of friends.
          </p>
        </header>

        <div className={CARD}>
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="mt-1 mb-5 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
          {children}
        </div>

        <p className="text-center text-sm text-[var(--color-ink-muted)]">{footer}</p>
      </div>
    </main>
  );
}

export function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  error,
  autoComplete,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  autoComplete: string;
  hint?: string;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error === undefined ? null : errorId, hint === undefined ? null : hintId]
    .filter((entry) => entry !== null)
    .join(' ');

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>

      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        disabled={disabled ?? false}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none transition-colors focus-visible:border-[var(--color-accent)] disabled:opacity-60 aria-[invalid=true]:border-red-500"
      />

      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {hint}
        </p>
      )}

      {error !== undefined && (
        <p id={errorId} className="mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Just a moment…' : children}
    </button>
  );
}

/** Form-level error, announced to assistive technology when it appears. */
export function FormError({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className="min-h-5">
      {message !== null && <p className="mb-3 text-sm text-red-500">{message}</p>}
    </div>
  );
}
