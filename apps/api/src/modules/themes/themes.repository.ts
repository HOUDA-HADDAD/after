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

/** What a group can write for itself. The capability flags are theirs to choose too (D19). */
export interface GroupThemeInput {
  slug: string;
  name: string;
  description: string;
  writePrompt: string;
  writePlaceholder: string;
  answerPrompt: string;
  icon: string;
  supportsComments: boolean;
  supportsAuthorGuess: boolean;
}

/**
 * Themes are data, not `if` statements (docs/00-spec-decisions.md D15). The capability flags on
 * a row decide whether comments and author guessing exist for a game — nothing branches on slug.
 *
 * A theme belongs to a group or to nobody. `groupId IS NULL` is one of the seeded defaults,
 * playable everywhere; anything else a group wrote for itself and is visible only there (D19).
 * Every read below is scoped accordingly, so "which themes may this group see" has one answer in
 * one place rather than a filter repeated at each call site.
 */
export const createThemesRepository = (db: DbClient) => ({
  /** The defaults plus this group's own, ordered for the picker. */
  async listForGroup(groupId: string): Promise<Theme[]> {
    return db.theme.findMany({
      where: { OR: [{ groupId: null }, { groupId }] },
      // Defaults first — a group's list grows over time, and the three everyone knows staying put
      // keeps the picker predictable. `nulls: 'first'` is the whole point: PostgreSQL sorts NULLs
      // last in an ascending order, which without this puts the group's own themes above them.
      orderBy: [
        { groupId: { sort: 'asc', nulls: 'first' } },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });
  },

  /** Only what this group wrote — for the management screen, which never edits a default. */
  async listOwnedBy(groupId: string): Promise<Theme[]> {
    return db.theme.findMany({ where: { groupId }, orderBy: [{ name: 'asc' }] });
  },

  async findSystemBySlug(slug: string): Promise<Theme | null> {
    return db.theme.findFirst({ where: { slug, groupId: null } });
  },

  async findById(id: string): Promise<Theme | null> {
    return db.theme.findUnique({ where: { id } });
  },

  async createForGroup(groupId: string, input: GroupThemeInput): Promise<Theme> {
    return db.theme.create({ data: { ...input, groupId, isSystem: false, sortOrder: 100 } });
  },

  async updateForGroup(id: string, input: GroupThemeInput): Promise<Theme> {
    return db.theme.update({ where: { id }, data: input });
  },

  async deleteById(id: string): Promise<void> {
    await db.theme.delete({ where: { id } });
  },

  /**
   * How many games still reference this theme.
   *
   * A finished game keeps its theme on screen until the purge window closes (D11), so deleting
   * one out from under a timeline would leave a game nobody can render. The service refuses
   * instead of cascading.
   */
  async countSessionsUsing(themeId: string): Promise<number> {
    return db.gameSession.count({ where: { themeId } });
  },

  /**
   * Idempotent by slug, so the seed is safe to run on every release. Updates copy and capability
   * flags but never `isSystem`, so a default cannot be demoted into a deletable theme by a
   * re-seed.
   *
   * Read-then-write rather than `upsert`: the uniqueness that matters is the partial index on
   * `(slug) WHERE group_id IS NULL`, which `upsert` cannot name — a compound unique key cannot be
   * looked up with a NULL member.
   */
  async upsertSystemTheme(input: SystemThemeInput): Promise<Theme> {
    const { slug, ...rest } = input;
    const existing = await db.theme.findFirst({ where: { slug, groupId: null } });

    if (existing === null) {
      return db.theme.create({ data: { slug, ...rest, isSystem: true } });
    }

    return db.theme.update({ where: { id: existing.id }, data: rest });
  },
});

export type ThemesRepository = ReturnType<typeof createThemesRepository>;
