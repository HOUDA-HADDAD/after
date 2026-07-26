import {
  ConflictError,
  ERROR_CODES,
  NotFoundError,
  type GroupThemeDto,
  type GroupThemeInput,
  type SessionThemeDto,
} from '@aftergame/shared';
import { assertCan } from '../../lib/authorize.js';
import { requireActor } from '../groups/group-access.js';
import type { GroupsRepository } from '../groups/groups.repository.js';
import { toThemeDto } from '../sessions/sessions.mapper.js';
import type { ThemesRepository } from './themes.repository.js';

export interface ThemesServiceDeps {
  themes: ThemesRepository;
  groups: GroupsRepository;
}

/** A slug from a name: stable, readable in a URL, and unique within the group by construction. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

  // A name of pure emoji or punctuation leaves nothing behind; the row still needs a slug.
  return base === '' ? 'theme' : base;
}

/**
 * Group-written themes (D19).
 *
 * A theme is the prompt everyone at the table then has to answer, so writing one is a host power
 * for the same reason opening a game is. Reading is not: you cannot decide whether to join a game
 * without knowing what it asks of you.
 *
 * The seeded defaults belong to nobody and are never editable here — the only way to change them
 * is a seed row and a deploy, which is what makes "Anecdotes" mean the same thing in every group.
 */
export function createThemesService({ themes, groups }: ThemesServiceDeps) {
  const uniqueSlug = async (groupId: string, name: string, exceptId?: string): Promise<string> => {
    const owned = await themes.listOwnedBy(groupId);
    const taken = new Set(
      owned.filter((theme) => theme.id !== exceptId).map((theme) => theme.slug),
    );
    const base = slugify(name);

    if (!taken.has(base)) return base;

    // Two themes called "Confessions" in one group is a reasonable thing to do by accident; a
    // 409 in their face is not the right answer to it.
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${base}-${String(suffix)}`;

      if (!taken.has(candidate)) return candidate;
    }

    throw new ConflictError(ERROR_CODES.CONFLICT, 'Too many themes with that name');
  };

  const requireOwnTheme = async (groupId: string, themeId: string) => {
    const theme = await themes.findById(themeId);

    // A theme of another group, or a seeded default, is answered the same way as one that does
    // not exist: there is nothing here for you.
    if (theme === null || theme.groupId !== groupId) throw new NotFoundError();

    return theme;
  };

  return {
    /** What this group may play: the defaults plus its own. */
    async listPlayable(groupId: string, userId: string): Promise<SessionThemeDto[]> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('theme:read', actor);

      return (await themes.listForGroup(groupId)).map((theme) => toThemeDto(theme, groupId));
    },

    /** What this group wrote, with the usage count that decides whether it can be deleted. */
    async listOwn(groupId: string, userId: string): Promise<GroupThemeDto[]> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('theme:read', actor);

      const owned = await themes.listOwnedBy(groupId);

      return Promise.all(
        owned.map(async (theme) => ({
          id: theme.id,
          slug: theme.slug,
          name: theme.name,
          description: theme.description,
          writePrompt: theme.writePrompt,
          writePlaceholder: theme.writePlaceholder,
          answerPrompt: theme.answerPrompt,
          icon: theme.icon,
          supportsComments: theme.supportsComments,
          supportsAuthorGuess: theme.supportsAuthorGuess,
          usedByGames: await themes.countSessionsUsing(theme.id),
          createdAt: theme.createdAt.toISOString(),
        })),
      );
    },

    async create(groupId: string, userId: string, input: GroupThemeInput): Promise<GroupThemeDto> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('theme:manage', actor);

      const created = await themes.createForGroup(groupId, {
        ...input,
        slug: await uniqueSlug(groupId, input.name),
      });

      return {
        ...input,
        id: created.id,
        slug: created.slug,
        usedByGames: 0,
        createdAt: created.createdAt.toISOString(),
      };
    },

    async update(
      groupId: string,
      userId: string,
      themeId: string,
      input: GroupThemeInput,
    ): Promise<GroupThemeDto> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('theme:manage', actor);

      const existing = await requireOwnTheme(groupId, themeId);

      /**
       * Editing a theme a game is using would rewrite the prompt under people mid-sentence — the
       * banner is pinned all game precisely so it does not change. Finished games keep it on
       * screen until the purge window closes, so "in use" includes those.
       */
      const uses = await themes.countSessionsUsing(themeId);

      if (uses > 0) {
        throw new ConflictError(
          ERROR_CODES.CONFLICT,
          'That theme is in use by a game',
          'Themes cannot change while a game is being played or read. Make a new one instead.',
        );
      }

      const updated = await themes.updateForGroup(themeId, {
        ...input,
        slug: await uniqueSlug(groupId, input.name, existing.id),
      });

      return {
        ...input,
        id: updated.id,
        slug: updated.slug,
        usedByGames: 0,
        createdAt: updated.createdAt.toISOString(),
      };
    },

    async remove(groupId: string, userId: string, themeId: string): Promise<void> {
      const actor = await requireActor(groups, groupId, userId);
      assertCan('theme:manage', actor);

      await requireOwnTheme(groupId, themeId);

      const uses = await themes.countSessionsUsing(themeId);

      if (uses > 0) {
        throw new ConflictError(
          ERROR_CODES.CONFLICT,
          'That theme is in use by a game',
          `${String(uses)} game${uses === 1 ? '' : 's'} still reference it. Finished games are deleted after the grace window, and it can be removed then.`,
        );
      }

      await themes.deleteById(themeId);
    },
  };
}

export type ThemesService = ReturnType<typeof createThemesService>;
