import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { cn } from '@aftergame/ui';
import { useT } from '../../../shared/i18n/LocaleProvider.js';

/**
 * The room code, as a chip beside the room name.
 *
 * It used to own a card of its own, which gave a party's most-shared eight characters the visual
 * weight of a settings panel. As a chip it sits where people look for it — next to the name they
 * are about to read out loud.
 *
 * The whole chip is the copy button rather than a chip with a button glued on: the target is then
 * comfortably past 44px on a phone, and there is no small hit area next to a big inert one.
 */
export function RoomCode({
  code,
  canRegenerate,
  regenerating,
  onRegenerate,
}: {
  code: string | undefined;
  canRegenerate: boolean;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A component that unmounts mid-flash would otherwise set state on a dead component.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (code === undefined) {
    return <span className="text-sm text-[var(--color-ink-muted)]">{t('room.noCode')}</span>;
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard permission can be refused, and on an insecure origin the API is simply absent.
      // The code is on screen either way, so the honest response is to say nothing and let them
      // read it — not to raise an error about a convenience.
      return;
    }

    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
    }, 1800);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => void copy()}
        // Spelled out for anyone hearing it rather than seeing it — "NCHGNA29" read as a word is
        // useless, and this is a string people dictate across a room.
        aria-label={`${t('room.copyCode')}: ${code.split('').join(' ')}`}
        className={cn(
          'group inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1',
          'text-sm font-medium transition-all duration-200',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          copied
            ? 'border-[var(--color-success)] bg-[var(--color-success-subtle)] text-[var(--color-success)]'
            : cn(
                'border-[var(--color-border)] bg-[var(--color-surface-sunken)]',
                'hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]',
                'motion-safe:hover:-translate-y-px',
              ),
        )}
      >
        <span className="text-xs tracking-wide text-[var(--color-ink-muted)] uppercase">
          {t('room.code')}
        </span>

        <span className="font-mono tracking-[0.18em] tabular-nums">{code}</span>

        {copied ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy
            size={14}
            aria-hidden="true"
            className="text-[var(--color-ink-muted)] transition-colors group-hover:text-[var(--color-accent)]"
          />
        )}
      </button>

      {/* Announced once when it changes, rather than living permanently in the tab order. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t('room.codeCopied') : ''}
      </span>

      {canRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          aria-label={t('room.generateCode')}
          title={t('room.generateCode')}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-full',
            'text-[var(--color-ink-muted)] transition-colors',
            'hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={cn(regenerating && 'motion-safe:animate-spin')}
          />
        </button>
      )}
    </span>
  );
}
