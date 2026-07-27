import { Languages } from 'lucide-react';
import { cn } from '@aftergame/ui';
import { useLocale } from '../i18n/LocaleProvider.js';
import { LOCALES, type Locale, type TranslationKey } from '../i18n/translations.js';

/**
 * A language's own name, from the dictionary rather than a map here.
 *
 * These read the same in every locale by design — a language is named in the language it names,
 * so a French reader looking for their own is looking for "Français", not "French". Keeping them
 * in the dictionary anyway means one place to edit when a locale is added, and one place the
 * translation guard can see.
 */
const NAME_KEY = { en: 'language.en', fr: 'language.fr' } as const satisfies Record<
  Locale,
  TranslationKey
>;

/**
 * The language switcher.
 *
 * A native `<select>` rather than a custom dropdown, and that is a deliberate choice rather than
 * a shortcut: it is keyboard-operable, screen-reader-announced and — on a phone — opens the
 * platform's own picker, which is a better control than anything worth rebuilding here. The
 * styling wraps it; the behaviour is the browser's.
 */
export function LanguageMenu({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className={cn('relative', className)}>
      <Languages
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--color-ink-muted)]"
      />

      <select
        value={locale}
        aria-label={t('language.label')}
        onChange={(event) => {
          setLocale(event.target.value as Locale);
        }}
        className={cn(
          // A real 44px, not an expanded hit area: a `<select>` is a replaced element and will
          // not render the pseudo-element the other controls use, so this is the one place the
          // target has to be the element itself. It matches the icon buttons beside it.
          'h-11 cursor-pointer appearance-none rounded-[var(--radius-control)]',
          'border border-transparent',
          'bg-transparent py-0 pr-2 pl-7 text-sm font-medium text-[var(--color-ink-muted)]',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-in-out)]',
          'hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
        )}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>

      {/* The full name for anyone reading the options aloud; the chip itself stays two letters. */}
      <span className="sr-only">{t(NAME_KEY[locale])}</span>
    </div>
  );
}
