import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LOCALES, TRANSLATIONS, type Locale, type TranslationKey } from './translations.js';

const STORAGE_KEY = 'aftergame:locale';

/** Values interpolated into a string, as `{name}` placeholders. */
export type TranslationValues = Record<string, string | number>;

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const isLocale = (value: string): value is Locale => (LOCALES as string[]).includes(value);

/**
 * The starting language.
 *
 * A stored choice always wins — someone who picked French meant it. Otherwise the browser decides,
 * which is the difference between an app that happens to be translated and one that arrives in
 * your language. English is the fallback because it is the language the copy is written in.
 */
function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored !== null && isLocale(stored)) return stored;

  for (const candidate of navigator.languages) {
    const base = candidate.split('-')[0] ?? '';

    if (isLocale(base)) return base;
  }

  return 'en';
}

/** Replace `{name}` placeholders. Missing values are left visible rather than silently blanked. */
function interpolate(template: string, values?: TranslationValues): string {
  if (values === undefined) return template;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];

    return value === undefined ? whole : String(value);
  });
}

/**
 * Language, for the whole app.
 *
 * Deliberately hand-rolled rather than `react-i18next`. The dictionary is a typed object, so a
 * wrong key is a compile error and a missing French string fails the build — guarantees a runtime
 * lookup library cannot give. It also keeps the client free of a dependency whose feature set
 * (backends, lazy namespaces, ICU) this app has no use for. If plural rules beyond one/other are
 * ever needed, that is the moment to reconsider.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    // Assistive technology and the browser's own translation prompt both read this.
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) =>
      interpolate(TRANSLATIONS[locale][key], values),
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext value={value}>{children}</LocaleContext>;
}

export function useLocale(): LocaleContextValue {
  const context = use(LocaleContext);

  if (context === null) throw new Error('useLocale must be used inside a LocaleProvider');

  return context;
}

/** The common case: just the translate function. */
export function useT(): LocaleContextValue['t'] {
  return useLocale().t;
}

/**
 * "1 member" / "5 members", without pulling in an ICU formatter.
 *
 * English and French agree on the shape of this one — a singular form and a plural form — so two
 * keys is the whole rule. A language with a dual or a paucal would need `Intl.PluralRules`, and
 * this is the seam to add it at.
 */
export function usePlural(): (one: TranslationKey, other: TranslationKey, count: number) => string {
  const t = useT();

  return useCallback(
    (one, other, count) => (count === 1 ? t(one, { count }) : t(other, { count })),
    [t],
  );
}
