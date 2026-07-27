import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { en, fr, LOCALES } from '../src/shared/i18n/translations.js';

// `process.cwd()` rather than `import.meta.url`: vitest runs this file through its transform, and
// under happy-dom the module URL is not a file URL.
const SRC = resolve(process.cwd(), 'src');

/**
 * Strings that are correctly not translated, with the reason.
 *
 * Kept short and justified. A growing allowlist is the failure mode of a rule like this — every
 * entry should be something no language would render differently.
 */
const ALLOWED = new Set([
  // The product's name. Brands are not translated.
  'Aftergame',
  // A sample invite code, showing the shape rather than saying anything. The alphabet is the
  // same in every language (docs/00-spec-decisions.md, INVITE_CODE_ALPHABET).
  'ABCD2345',
]);

/** Props whose value a person reads on screen or hears from a screen reader. */
const VISIBLE_PROPS = [
  'aria-label',
  'title',
  'placeholder',
  'label',
  'hint',
  'subtitle',
  'description',
  'submitLabel',
];

/** Class names, URLs, ids and file paths look like copy and are not. */
const NOT_COPY =
  /^(?:[a-z-]+(?:\s[a-z-]+)*|[A-Z_]+|https?:\/\/.*|\/[\w/:-]*|#[\w-]+|[\w.-]+\.\w+)$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) return entry === 'i18n' ? [] : sourceFiles(path);

    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function untranslatedIn(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const where = relative(SRC, path).replaceAll('\\', '/');
  const found: string[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (/^(?:\/\/|\*|\/\*|import|export (?:type|interface))/.test(trimmed)) return;

    for (const prop of VISIBLE_PROPS) {
      const match = new RegExp(`${prop}="([^"]+)"`).exec(line);

      if (match?.[1] !== undefined && !NOT_COPY.test(match[1]) && !ALLOWED.has(match[1])) {
        found.push(`${where}:${String(index + 1)} ${prop}="${match[1]}"`);
      }
    }

    // A line that is only words, sitting between two tags, is rendered text.
    if (/^[A-Z][A-Za-z0-9 ,.'’!?—:()/-]{3,}$/.test(trimmed) && !ALLOWED.has(trimmed)) {
      const before = lines[index - 1]?.trim() ?? '';
      const after = lines[index + 1]?.trim() ?? '';

      if (before.endsWith('>') && after.startsWith('</')) {
        found.push(`${where}:${String(index + 1)} text "${trimmed}"`);
      }
    }

    // Text between a tag and a closing tag on one line, like `<span>(you)</span>`. Requiring the
    // `</` is what separates copy from a generic: `Promise<void>` and `apiPut<Theme>` produce the
    // same `>…<` shape and are not copy.
    for (const match of line.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)<\//g)) {
      const text = (match[1] ?? '').trim();

      if (text !== '' && !NOT_COPY.test(text) && !ALLOWED.has(text)) {
        found.push(`${where}:${String(index + 1)} text "${text}"`);
      }
    }

    // `count === 1 ? 'member' : 'members'`. Found by hand twice, in two files, because a bare
    // lowercase word is indistinguishable from a class name to every rule above — but a ternary
    // picking between a word and that word plus an `s` is only ever English grammar. `usePlural`
    // exists for this, and languages that do not pluralise on `s` need it.
    const pluralised = /\?\s*'([a-z]+)'\s*:\s*'\1(?:e?s)'/.exec(line);

    if (pluralised !== null) {
      found.push(`${where}:${String(index + 1)} hard-coded plural "${pluralised[1] ?? ''}"`);
    }

    // A literal handed straight to a toast. Found by hand once — a template literal reads as code
    // to the two rules above, and `toast.success(\`Created ${name}\`)` is copy either way.
    const announced = /\b(?:toast(?:\.\w+)?|alert|confirm)\(\s*(['"`])(.+?)\1/.exec(line);

    if (announced?.[2] !== undefined && !NOT_COPY.test(announced[2])) {
      found.push(`${where}:${String(index + 1)} announced "${announced[2]}"`);
    }
  });

  return found;
}

/**
 * The guard that keeps the app translated.
 *
 * Adding a language should be a file, not an archaeology project — which is only true while no
 * English is hiding in a component. This is the cheapest thing that keeps that true: it reads the
 * source and fails on copy that never reached the dictionary.
 *
 * It is a test rather than a lint rule because it needs to look at the line above and below to
 * tell rendered text from a code identifier, and because a failure here is a product bug — a
 * French reader seeing English — rather than a style violation.
 */
describe('every user-facing string is translated', () => {
  it('finds no hard-coded copy in the source', () => {
    const findings = sourceFiles(SRC).flatMap(untranslatedIn);

    expect(findings, `These strings never reached the dictionary:\n${findings.join('\n')}`).toEqual(
      [],
    );
  });
});

describe('the dictionaries', () => {
  it('cover the same keys in every language', () => {
    // The compiler already enforces this — `fr` is typed `Record<TranslationKey, string>`. The
    // test exists for the case someone reaches for a cast to silence it.
    const english = Object.keys(en).sort();
    const french = Object.keys(fr).sort();

    expect(french).toEqual(english);
  });

  it('leaves no French string identical to its English source by accident', () => {
    // A handful are correctly identical: words French borrowed unchanged, and the language names
    // in the switcher, which are always shown in the language they name. Everything else being
    // identical would be a copy-paste that never got translated — so the list is named rather
    // than counted, and a new entry has to be justified when it is added.
    const sameInBoth = Object.keys(en).filter(
      (key) => en[key as keyof typeof en] === fr[key as keyof typeof fr],
    );

    expect(sameInBoth.sort()).toEqual([
      'customThemes.description', // "Description"
      'language.en', // shown in the language it names
      'language.fr', // likewise
      'phase.REVIEW', // "Discussion"
      'room.code', // "Code"
    ]);
  });

  it('interpolates the same placeholders in every language', () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

    const mismatched = Object.keys(en).filter((key) => {
      const source = placeholders(en[key as keyof typeof en]);
      const target = placeholders(fr[key as keyof typeof fr]);

      return source.join() !== target.join();
    });

    // A translation that drops `{count}` renders "You have texts to answer" and nobody notices
    // until a French speaker does.
    expect(mismatched).toEqual([]);
  });

  it('offers every locale it claims to', () => {
    expect(LOCALES).toEqual(['en', 'fr']);
  });
});
