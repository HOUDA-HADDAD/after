import type { PrismaClient } from '@prisma/client';
import {
  createThemesRepository,
  type SystemThemeInput,
} from '../src/modules/themes/themes.repository.js';

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
    description: 'Write a question. Someone else answers it, and nobody knows who asked.',
    writePrompt: 'Write a question for someone else to answer',
    writePlaceholder: 'What is the craziest thing you have ever done?',
    answerPrompt: 'Answer honestly — nobody knows it is you',
    icon: 'circle-help',
    supportsComments: false,
    supportsAuthorGuess: false,
    sortOrder: 10,
  },
  {
    slug: 'challenges',
    name: 'Challenges',
    description: 'Set a challenge. Someone else has to rise to it — or talk their way out.',
    writePrompt: 'Write a challenge for someone else',
    writePlaceholder: 'Imitate someone from the group.',
    answerPrompt: 'Tell everyone how it went',
    icon: 'flame',
    supportsComments: false,
    supportsAuthorGuess: false,
    sortOrder: 20,
  },
  {
    slug: 'anecdotes',
    name: 'Anecdotes',
    description: 'Ask for a story. Read the answers, talk about them, then guess who asked.',
    writePrompt: 'Write a prompt that asks for a story',
    writePlaceholder: 'Tell us about your funniest childhood memory.',
    answerPrompt: 'Tell your story',
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
export async function seedThemes(prisma: PrismaClient): Promise<number> {
  const themes = createThemesRepository(prisma);

  for (const theme of SYSTEM_THEMES) {
    await themes.upsertSystemTheme(theme);
  }

  return SYSTEM_THEMES.length;
}
