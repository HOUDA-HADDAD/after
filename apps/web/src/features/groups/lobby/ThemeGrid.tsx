import { Check } from 'lucide-react';
import { cn } from '@aftergame/ui';
import type { SessionThemeDto } from '@aftergame/shared';
import { useT } from '../../../shared/i18n/LocaleProvider.js';

/**
 * The game-mode selector.
 *
 * Large cards rather than a radio list, because picking the theme *is* the decision a host makes
 * — it decides what everybody will be asked to write. A list of small circles gave it the weight
 * of a form field.
 *
 * The semantics stay a radio group. It looks like a set of game tiles and behaves like the native
 * control: arrow keys move between options, one tab stop for the whole group, and a screen reader
 * announces "Anecdotes, radio button, 3 of 3". Rebuilding that with click handlers on divs is how
 * game UIs end up unusable by keyboard.
 */
export function ThemeGrid({
  themes,
  selectedId,
  disabled,
  onSelect,
}: {
  themes: SessionThemeDto[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (themeId: string) => void;
}) {
  const t = useT();

  return (
    <div
      role="radiogroup"
      aria-label={t('themes.title')}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {themes.map((theme, index) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          selected={theme.id === selectedId}
          disabled={disabled}
          // Only the selected option is in the tab order; arrows move within the group. That is
          // the native radio behaviour, and `tabIndex` is what preserves it here.
          tabbable={selectedId === null ? index === 0 : theme.id === selectedId}
          onSelect={() => {
            onSelect(theme.id);
          }}
          onMove={(direction) => {
            const next = (index + direction + themes.length) % themes.length;
            const target = themes[next];

            if (target !== undefined) onSelect(target.id);
          }}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  theme,
  selected,
  disabled,
  tabbable,
  onSelect,
  onMove,
}: {
  theme: SessionThemeDto;
  selected: boolean;
  disabled: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onMove: (direction: 1 | -1) => void;
}) {
  const t = useT();

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          onMove(1);
        }

        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          onMove(-1);
        }
      }}
      className={cn(
        'group relative flex flex-col items-start gap-2 overflow-hidden p-5 text-left',
        'rounded-[var(--radius-card)] border transition-all duration-[var(--duration-base)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        selected
          ? cn(
              'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]',
              'shadow-[0_0_0_1px_var(--color-accent),var(--shadow-lift)]',
            )
          : cn(
              'border-[var(--color-border)] bg-[var(--color-surface-raised)]',
              'hover:border-[var(--color-accent)] hover:shadow-[var(--shadow-lift)]',
              'motion-safe:hover:-translate-y-1 motion-safe:not-disabled:active:translate-y-0',
            ),
      )}
    >
      {/* A wash that fades in on hover. Purely decorative, and behind everything that is not. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[var(--duration-base)] ease-[var(--ease-out)]',
          'bg-[image:var(--gradient-lobby)]',
          selected ? 'opacity-100' : 'group-hover:opacity-100',
        )}
      />

      <span className="relative flex w-full items-start justify-between gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)]',
            'text-2xl transition-transform duration-[var(--duration-base)]',
            selected ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-sunken)]',
            'motion-safe:group-hover:scale-110',
          )}
        >
          {theme.icon}
        </span>

        {selected && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              'bg-[var(--color-accent)] text-[var(--color-accent-ink)]',
              'motion-safe:animate-[fade-in-up_200ms_ease-out]',
            )}
          >
            <Check size={12} aria-hidden="true" />
            {t('themes.selected')}
          </span>
        )}
      </span>

      <span className="relative flex items-center gap-2">
        <span className="text-base font-semibold">{theme.name}</span>
        {theme.isCustom && (
          <span className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] tracking-wide text-[var(--color-ink-muted)] uppercase">
            {t('themes.yours')}
          </span>
        )}
      </span>

      <span className="relative text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {theme.description}
      </span>
    </button>
  );
}
