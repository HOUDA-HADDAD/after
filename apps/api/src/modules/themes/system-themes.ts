import { createThemesRepository, type SystemThemeInput } from './themes.repository.js';
import type { DbClient } from '../../lib/db.js';

/**
 * The three default themes from the specification.
 *
 * Capability flags — not slug checks — decide behaviour: Anecdotes is the only theme that
 * collects comments and author guesses, because its row says so (docs/00-spec-decisions.md D15).
 */
export const SYSTEM_THEMES: readonly SystemThemeInput[] = [
  {
    slug: 'questions',
    name: 'Questions',
    description: 'Écrivez une question. Une autre personne y répond, sans savoir qui l’a posée.',
    writePrompt: 'Écrivez une question pour une autre personne',
    writePlaceholder: 'Quelle est la chose la plus folle que vous ayez faite ?',
    answerPrompt: 'Répondez honnêtement : personne ne sait que c’est vous',
    icon: 'circle-help',
    supportsComments: false,
    supportsAuthorGuess: false,
    sortOrder: 10,
  },
  {
    slug: 'challenges',
    name: 'Défis',
    description: 'Proposez un défi. Une autre personne devra le relever ou trouver une excuse.',
    writePrompt: 'Écrivez un défi pour une autre personne',
    writePlaceholder: 'Imitez une personne du salon.',
    answerPrompt: 'Racontez comment cela s’est passé',
    icon: 'flame',
    supportsComments: false,
    supportsAuthorGuess: false,
    sortOrder: 20,
  },
  {
    slug: 'anecdotes',
    name: 'Anecdotes',
    description: 'Demandez une histoire. Lisez les réponses, discutez-en, puis devinez qui a posé la question.',
    writePrompt: 'Écrivez une consigne qui invite à raconter une histoire',
    writePlaceholder: 'Racontez votre souvenir d’enfance le plus drôle.',
    answerPrompt: 'Racontez votre histoire',
    icon: 'message-circle-heart',
    supportsComments: true,
    supportsAuthorGuess: true,
    sortOrder: 30,
  },
] as const;

/**
 * Idempotent by slug, so this runs on every release without duplicating or resetting anything a
 * host has not asked to change.
 */
export async function seedThemes(prisma: DbClient): Promise<number> {
  const themes = createThemesRepository(prisma);

  for (const theme of SYSTEM_THEMES) {
    await themes.upsertSystemTheme(theme);
  }

  return SYSTEM_THEMES.length;
}
