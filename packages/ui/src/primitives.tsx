import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * The primitives every screen is built from.
 *
 * Deliberately few. A component earns its place here by being used in more than one feature and
 * by carrying behaviour worth writing once — accessible labelling, focus handling, a disabled
 * state that actually stops a double submit. Anything that is only styling stays as classes at
 * the call site, where it is easier to read than a prop matrix.
 */

export const cn = clsx;

/* ---- Button ------------------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-55';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-hover)]',
  secondary:
    'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] ' +
    'hover:border-[var(--color-border-strong)]',
  ghost: 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]',
  danger:
    'border border-[var(--color-border)] text-[var(--color-danger)] hover:bg-[var(--color-danger-subtle)]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  // 44px: the minimum comfortable touch target, so the same button works on a phone.
  md: 'h-11 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a busy state and blocks further clicks. */
  pending?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  pending = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Buttons default to `submit` inside a form, which submits it by accident. Callers that
      // want a submit button say so.
      type="button"
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---- Field ------------------------------------------------------------------------------- */

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  /** Hide the label visually but keep it for screen readers. */
  labelHidden?: boolean;
}

/**
 * A labelled input.
 *
 * The label is always present — visually hidden at most, never absent — and errors and hints are
 * wired through `aria-describedby` so a screen reader reads the problem with the field rather
 * than as a detached announcement somewhere else on the page.
 */
export function Field({
  id,
  label,
  error,
  hint,
  labelHidden = false,
  className,
  ...rest
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    <div className="mb-4">
      <label
        htmlFor={id}
        className={cn('mb-1 block text-sm font-medium', labelHidden && 'sr-only')}
      >
        {label}
      </label>

      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(
          'h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border)]',
          'bg-[var(--color-surface)] px-3 text-sm outline-none transition-colors',
          'focus-visible:border-[var(--color-accent)] disabled:opacity-60',
          error !== undefined && 'border-[var(--color-danger)]',
          className,
        )}
        {...rest}
      />

      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {hint}
        </p>
      )}

      {error !== undefined && (
        <p id={errorId} className="mt-1 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---- Surfaces ---------------------------------------------------------------------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--color-border)]',
        'bg-[var(--color-surface-raised)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A loading placeholder shaped like the content it replaces.
 *
 * Skeletons rather than a page spinner: the layout does not jump when the data lands, and the
 * screen says what is coming instead of only that something is.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)]',
        className,
      )}
    />
  );
}

/** Announces to assistive technology that something is loading, without a visual spinner. */
export function LoadingRegion({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/** An empty state that explains what would be here and how to get it. */
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] px-6 py-10 text-center">
      {icon !== undefined && <div className="mb-3 text-[var(--color-ink-subtle)]">{icon}</div>}
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">{description}</p>
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A short status word — a role, a phase, a count. */
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'danger';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'border-[var(--color-border)] text-[var(--color-ink-muted)]',
    accent: 'border-transparent bg-[var(--color-accent-subtle)] text-[var(--color-accent)]',
    danger: 'border-transparent bg-[var(--color-danger-subtle)] text-[var(--color-danger)]',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Inline error text, announced when it appears. */
export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-[var(--color-danger)]">
      {children}
    </p>
  );
}

/* ---- Avatar ------------------------------------------------------------------------------- */

/**
 * A deterministic hue from a name.
 *
 * The same person is the same colour on every screen and in every session, without storing
 * anything — which is what makes a roster scannable at a glance. A plain sum of code points is
 * enough; this is decoration, not a hash with anything to defend.
 */
function hueFor(name: string): number {
  let total = 0;

  for (const character of name) total = (total + character.codePointAt(0)!) % 360;

  return total;
}

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** Draws the ring and dot that say "here". Omit entirely rather than passing `false` loudly. */
  online?: boolean;
  className?: string;
}

const AVATAR_SIZES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

/**
 * Initials in a coloured disc.
 *
 * `aria-hidden`, always: the name it stands for is next to it in every use, and an avatar that
 * announces "H" before the screen reader reads "HOUDA" is noise. The presence dot is decoration
 * too — the caller words the status, because only the caller knows where in the sentence it
 * belongs. Announcing "online" *before* the name is the kind of thing that technically passes an
 * audit and still reads like a machine.
 */
export function Avatar({ name, size = 'md', online = false, className }: AvatarProps) {
  const initials = name.trim().slice(0, 2).toUpperCase();
  const hue = hueFor(name);

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        aria-hidden="true"
        style={{
          backgroundColor: `oklch(88% 0.06 ${String(hue)})`,
          color: `oklch(32% 0.12 ${String(hue)})`,
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full font-semibold',
          'ring-2 ring-[var(--color-surface)]',
          AVATAR_SIZES[size],
        )}
      >
        {initials}
      </span>

      {online && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full',
            'bg-[var(--color-success)] ring-2 ring-[var(--color-surface-raised)]',
          )}
        />
      )}
    </span>
  );
}
