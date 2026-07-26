import { Languages } from 'lucide-react';
import { cn } from '@aftergame/ui';
import { useLocale } from '../i18n/LocaleProvider.js';
import { LOCALES, type Locale } from '../i18n/translations.js';

const LABEL: Record<Locale, string> = { en: 'English', fr: 'Français' };
const SHORT: Record<Locale, string> = { en: 'EN', fr: 'FR' };

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
          'h-9 cursor-pointer appearance-none rounded-[var(--radius-control)] border border-transparent',
          'bg-transparent py-0 pr-2 pl-7 text-sm font-medium text-[var(--color-ink-muted)]',
          'transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
        )}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {SHORT[code]}
          </option>
        ))}
      </select>

      {/* The full name for anyone reading the options aloud; the chip itself stays two letters. */}
      <span className="sr-only">{LABEL[locale]}</span>
    </div>
  );
}
