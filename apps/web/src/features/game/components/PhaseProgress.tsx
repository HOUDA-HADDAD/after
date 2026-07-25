import type { ProgressDto } from '@aftergame/shared';

/**
 * How far the room has got — and nothing else.
 *
 * `6 / 8 texts`, never "waiting for Sarah". The counter is the only signal the brief asks for and
 * the only one anonymity permits: naming who is late tells you who wrote the text that arrives
 * next. It is a `progressbar` so assistive technology gets the same information, and the visible
 * label is the accessible one rather than a second, different sentence.
 */
export function PhaseProgress({ progress, noun }: { progress: ProgressDto; noun: string }) {
  const { submitted, required } = progress;
  const percent = required === 0 ? 0 : Math.round((submitted / required) * 100);

  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={submitted}
        aria-valuemin={0}
        aria-valuemax={required}
        aria-label={`${String(submitted)} of ${String(required)} ${noun} in`}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)] tabular-nums">
        {submitted} / {required} {noun} in
      </p>
    </div>
  );
}
