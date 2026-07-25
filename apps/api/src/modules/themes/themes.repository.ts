import type { Theme } from '@prisma/client';
import type { DbClient } from '../../lib/db.js';

/** The three defaults, seeded by slug. Extra themes are a seed row, not an engineering task. */
export interface SystemThemeInput {
  slug: string;
  name: string;
  description: string;
  writePrompt: string;
  writePlaceholder: string;
  answerPrompt: string;
  icon: string;
  supportsComments: boolean;
  supportsAuthorGuess: boolean;
  sortOrder: number;
}

/**
 * Themes are data, not `if` statements (docs/00-spec-decisions.md D15). The capability flags on
 * a row decide whether comments and author guessing exist for a game — nothing branches on slug.
 */
export const createThemesRepository = (db: DbClient) => ({
  /** Ordered for the theme picker. */
  async list(): Promise<Theme[]> {
    return db.theme.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  },

  async findBySlug(slug: string): Promise<Theme | null> {
    return db.theme.findUnique({ where: { slug } });
  },

  async findById(id: string): Promise<Theme | null> {
    return db.theme.findUnique({ where: { id } });
  },

  /**
   * Idempotent by slug, so the seed is safe to run on every release. Updates copy and capability
   * flags but never `isSystem`, so a default cannot be demoted into a deletable theme by a
   * re-seed.
   */
  async upsertSystemTheme(input: SystemThemeInput): Promise<Theme> {
    const { slug, ...rest } = input;

    return db.theme.upsert({
      where: { slug },
      create: { slug, ...rest, isSystem: true },
      update: { ...rest },
    });
  },
});

export type ThemesRepository = ReturnType<typeof createThemesRepository>;
