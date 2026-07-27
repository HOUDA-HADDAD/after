import { REACTIONS, type ReactionTallyDto } from '@aftergame/shared';
import { cn } from '@aftergame/ui';
import { useT } from '../../../shared/i18n/LocaleProvider.js';

/**
 * Reactions on an answer (D20).
 *
 * A fixed palette, a count, and whether you are one of them — and deliberately no way to find out
 * who the others are. That is not a UI omission covering for the API: the payload has no field
 * for it, so there is nothing here to render even by mistake.
 *
 * Untouched emoji stay visible at low contrast rather than hiding behind a "+" button. A reaction
 * nobody can find is a reaction nobody uses, and six is few enough to show.
 */
export function ReactionBar({
  reactions,
  interactive,
  pending,
  onToggle,
}: {
  reactions: ReactionTallyDto[];
  /** False once the discussion closes — the tally stays readable, the buttons stop. */
  interactive: boolean;
  pending: boolean;
  onToggle: (emoji: string, on: boolean) => void;
}) {
  const t = useT();
  const byEmoji = new Map(reactions.map((tally) => [tally.emoji, tally]));
  const anyReactions = reactions.some((tally) => tally.count > 0);

  if (!interactive && !anyReactions) return null;

  const shown = interactive ? REACTIONS : REACTIONS.filter((emoji) => byEmoji.has(emoji));

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {shown.map((emoji) => {
        const tally = byEmoji.get(emoji);
        const count = tally?.count ?? 0;
        const mine = tally?.youReacted ?? false;

        const label = mine
          ? t('reactions.remove', { emoji })
          : count > 0
            ? t('reactions.reactCount', { emoji, count })
            : t('reactions.react', { emoji });

        return (
          <button
            key={emoji}
            type="button"
            disabled={!interactive || pending}
            aria-pressed={mine}
            aria-label={label}
            onClick={() => {
              onToggle(emoji, !mine);
            }}
            className={cn(
              'inline-flex min-h-8 items-center gap-1 rounded-full border px-2 py-0.5 text-sm',
              'transition-colors disabled:cursor-default',
              mine
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
              count === 0 && 'opacity-60',
            )}
          >
            <span aria-hidden="true">{emoji}</span>
            {count > 0 && (
              <span className="text-xs tabular-nums text-[var(--color-ink-muted)]">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
