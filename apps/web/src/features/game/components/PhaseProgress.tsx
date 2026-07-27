import type { ProgressDto } from '@aftergame/shared';
import { useT } from '../../../shared/i18n/LocaleProvider.js';

/**
 * How far the room has got — and nothing else.
 *
 * `6 / 8 texts`, never "waiting for Sarah". The counter is the only signal the brief asks for and
 * the only one anonymity permits: naming who is late tells you who wrote the text that arrives
 * next. It is a `progressbar` so assistive technology gets the same information, and the visible
 * label is the accessible one rather than a second, different sentence.
 */
export function PhaseProgress({
  progress,
  counting,
}: {
  progress: ProgressDto;
  /** Which noun the counter uses — the phase decides, and the translation owns the wording. */
  counting: 'texts' | 'answers';
}) {
  const t = useT();
  const { submitted, required } = progress;
  const percent = required === 0 ? 0 : Math.round((submitted / required) * 100);

  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={submitted}
        aria-valuemin={0}
        aria-valuemax={required}
        aria-label={t(counting === 'texts' ? 'progress.textsLabel' : 'progress.answersLabel', {
          submitted,
          required,
        })}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)] tabular-nums">
        {t(counting === 'texts' ? 'progress.texts' : 'progress.answers', { submitted, required })}
      </p>
    </div>
  );
}
