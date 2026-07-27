import { Trash2 } from 'lucide-react';
import { useT } from '../../../shared/i18n/LocaleProvider.js';

/** Hours until a timestamp, rounded down, floored at zero. */
function hoursUntil(iso: string, now: number): number {
  const remaining = new Date(iso).getTime() - now;

  return remaining <= 0 ? 0 : Math.floor(remaining / 3_600_000);
}

/**
 * "This game disappears in 23 hours."
 *
 * Games are deleted outright after the grace window (D11), and saying so is the difference
 * between a promise kept and data mysteriously vanishing. It is stated where someone reading the
 * timeline will see it, not buried in a settings page they will not visit.
 */
export function PurgeNotice({
  purgeAfter,
  now = Date.now(),
}: {
  purgeAfter: string | null;
  now?: number;
}) {
  const t = useT();

  if (purgeAfter === null) return null;

  const hours = hoursUntil(purgeAfter, now);

  return (
    <p className="mx-auto mt-6 mb-10 flex max-w-[72ch] items-center gap-2 px-4 text-sm text-[var(--color-ink-muted)] sm:px-6">
      <Trash2 size={14} aria-hidden="true" className="shrink-0" />
      {hours === 0
        ? t('game.purgeSoon')
        : hours === 1
          ? t('game.purgeHoursOne')
          : t('game.purgeHours', { count: hours })}
    </p>
  );
}
