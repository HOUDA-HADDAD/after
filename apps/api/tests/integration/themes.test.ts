import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { seedThemes } from '../../prisma/seed.js';
import { registerUser } from '../helpers/auth.js';
import { call } from '../helpers/game.js';

/**
 * Themes a group writes for itself (D19).
 *
 * Two properties carry the weight here. A group's themes belong to that group and are invisible
 * everywhere else — the routes are group-scoped precisely so that cannot be got wrong. And a
 * theme in use by a game is frozen, because the banner is pinned all game and rewriting the
 * prompt mid-sentence would land on the players rather than on whoever edited it.
 */
describe('group themes', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = testPrisma();
    ({ app } = await buildTestApp());
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedThemes(prisma);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  const theme = (overrides: Record<string, unknown> = {}) => ({
    name: 'Confessions',
    description: 'Own up to something.',
    writePrompt: 'Write a confession',
    writePlaceholder: 'I never actually…',
    answerPrompt: 'React honestly',
    icon: '🙊',
    supportsComments: true,
    supportsAuthorGuess: false,
    ...overrides,
  });

  /** A group with a host and one plain member. */
  async function makeGroup() {
    const host = await registerUser(app);
    const member = await registerUser(app);

    const groupId = (await call(app, host.token, 'POST', '/groups', { name: 'Friday' })).json()
      .id as string;
    const code = (
      await call(app, host.token, 'POST', `/groups/${groupId}/invitations`, {
        expiresInHours: null,
        maxUses: null,
      })
    ).json().code as string;

    await call(app, member.token, 'POST', '/join', { code });

    return { host, member, groupId };
  }

  describe('writing one', () => {
    it('lets a host add a theme the group can then play', async () => {
      const { host, groupId } = await makeGroup();

      const created = await call(app, host.token, 'POST', `/groups/${groupId}/themes`, theme());

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ name: 'Confessions', slug: 'confessions' });

      const playable = await call(app, host.token, 'GET', `/groups/${groupId}/themes`);
      const slugs = (playable.json().themes as { slug: string }[]).map((entry) => entry.slug);

      // The three defaults, plus the new one — and the defaults still come first.
      expect(slugs).toEqual(['questions', 'challenges', 'anecdotes', 'confessions']);
    });

    it('refuses a plain member', async () => {
      const { member, groupId } = await makeGroup();

      const response = await call(app, member.token, 'POST', `/groups/${groupId}/themes`, theme());

      // A theme is the prompt the whole table has to answer, so writing one is a host power.
      expect(response.statusCode).toBe(403);
    });

    it('lets a member read them, because joining a game means knowing what it asks', async () => {
      const { host, member, groupId } = await makeGroup();

      await call(app, host.token, 'POST', `/groups/${groupId}/themes`, theme());

      const response = await call(app, member.token, 'GET', `/groups/${groupId}/themes`);

      expect(response.statusCode).toBe(200);
      expect((response.json().themes as { slug: string }[]).map((e) => e.slug)).toContain(
        'confessions',
      );
    });

    it('refuses a blank prompt rather than storing a game nobody can start', async () => {
      const { host, groupId } = await makeGroup();

      const response = await call(
        app,
        host.token,
        'POST',
        `/groups/${groupId}/themes`,
        theme({ writePrompt: '   ' }),
      );

      expect(response.statusCode).toBe(400);
    });

    it('gives two themes of the same name distinct slugs instead of a conflict', async () => {
      const { host, groupId } = await makeGroup();

      await call(app, host.token, 'POST', `/groups/${groupId}/themes`, theme());
      const second = await call(app, host.token, 'POST', `/groups/${groupId}/themes`, theme());

      // Naming two themes the same thing is a reasonable thing to do by accident; a 409 in
      // someone's face is not the right answer to it.
      expect(second.statusCode).toBe(201);
      expect(second.json().slug).toBe('confessions-2');
    });
  });

  describe('themes belong to the group that wrote them', () => {
    it('hides them from a group that did not write them', async () => {
      const first = await makeGroup();
      const second = await makeGroup();

      await call(app, first.host.token, 'POST', `/groups/${first.groupId}/themes`, theme());

      const seen = await call(app, second.host.token, 'GET', `/groups/${second.groupId}/themes`);
      const slugs = (seen.json().themes as { slug: string }[]).map((entry) => entry.slug);

      expect(slugs).toEqual(['questions', 'challenges', 'anecdotes']);
    });

    it('refuses to start a game on another group’s theme', async () => {
      const first = await makeGroup();
      const second = await makeGroup();

      const created = await call(
        app,
        first.host.token,
        'POST',
        `/groups/${first.groupId}/themes`,
        theme(),
      );
      const themeId = created.json().id as string;

      // The foreign key would happily accept this — it has no opinion about who owns what. The
      // service is what makes the answer 404.
      const response = await call(
        app,
        second.host.token,
        'POST',
        `/groups/${second.groupId}/sessions`,
        { themeId },
      );

      expect(response.statusCode).toBe(404);
    });

    it('refuses to edit or delete a theme belonging to another group', async () => {
      const first = await makeGroup();
      const second = await makeGroup();

      const created = await call(
        app,
        first.host.token,
        'POST',
        `/groups/${first.groupId}/themes`,
        theme(),
      );
      const themeId = created.json().id as string;

      // Asked of the second group, whose host is a host — of somewhere else. Same answer as a
      // theme that does not exist, which is the only answer that gives nothing away.
      const edited = await call(
        app,
        second.host.token,
        'PUT',
        `/groups/${second.groupId}/themes/${themeId}`,
        theme({ name: 'Stolen' }),
      );
      const deleted = await call(
        app,
        second.host.token,
        'DELETE',
        `/groups/${second.groupId}/themes/${themeId}`,
      );

      expect(edited.statusCode).toBe(404);
      expect(deleted.statusCode).toBe(404);
    });
  });

  describe('the seeded defaults', () => {
    it('cannot be edited or deleted through the group routes', async () => {
      const { host, groupId } = await makeGroup();

      const playable = await call(app, host.token, 'GET', `/groups/${groupId}/themes`);
      const anecdotes = (playable.json().themes as { id: string; slug: string }[]).find(
        (entry) => entry.slug === 'anecdotes',
      )!;

      const edited = await call(
        app,
        host.token,
        'PUT',
        `/groups/${groupId}/themes/${anecdotes.id}`,
        theme(),
      );
      const deleted = await call(
        app,
        host.token,
        'DELETE',
        `/groups/${groupId}/themes/${anecdotes.id}`,
      );

      // A default belongs to nobody, which is what makes "Anecdotes" mean the same thing in every
      // group. The only way to change one is a seed row and a deploy.
      expect(edited.statusCode).toBe(404);
      expect(deleted.statusCode).toBe(404);
    });

    it('describes ownership so a client knows what it may offer to change', async () => {
      const { host, groupId } = await makeGroup();

      await call(app, host.token, 'POST', `/groups/${groupId}/themes`, theme());

      const themes = (await call(app, host.token, 'GET', `/groups/${groupId}/themes`)).json()
        .themes as { slug: string; isSystem: boolean; isCustom: boolean }[];

      expect(themes.find((entry) => entry.slug === 'anecdotes')).toMatchObject({
        isSystem: true,
        isCustom: false,
      });
      expect(themes.find((entry) => entry.slug === 'confessions')).toMatchObject({
        isSystem: false,
        isCustom: true,
      });
    });
  });

  describe('a theme a game is using', () => {
    async function themeInUse() {
      const { host, groupId } = await makeGroup();
      const created = await call(app, host.token, 'POST', `/groups/${groupId}/themes`, theme());
      const themeId = created.json().id as string;

      await call(app, host.token, 'POST', `/groups/${groupId}/sessions`, { themeId });

      return { host, groupId, themeId };
    }

    it('cannot be deleted while a game still renders it', async () => {
      const { host, groupId, themeId } = await themeInUse();

      const response = await call(
        app,
        host.token,
        'DELETE',
        `/groups/${groupId}/themes/${themeId}`,
      );

      // A finished game keeps its theme on screen until the purge window closes (D11), so this
      // says when rather than simply refusing.
      expect(response.statusCode).toBe(409);
      expect(response.json().detail).toMatch(/grace window/i);
    });

    it('cannot be edited either — the banner is pinned for the whole game', async () => {
      const { host, groupId, themeId } = await themeInUse();

      const response = await call(
        app,
        host.token,
        'PUT',
        `/groups/${groupId}/themes/${themeId}`,
        theme({ name: 'Rewritten mid-game' }),
      );

      expect(response.statusCode).toBe(409);
    });

    it('reports the usage count, so the screen can explain itself', async () => {
      const { host, groupId } = await themeInUse();

      const own = (await call(app, host.token, 'GET', `/groups/${groupId}/themes/custom`)).json()
        .themes as { usedByGames: number }[];

      expect(own).toHaveLength(1);
      expect(own[0]?.usedByGames).toBe(1);
    });

    it('is deletable once nothing references it', async () => {
      const { host, groupId } = await makeGroup();
      const created = await call(app, host.token, 'POST', `/groups/${groupId}/themes`, theme());

      const response = await call(
        app,
        host.token,
        'DELETE',
        `/groups/${groupId}/themes/${created.json().id as string}`,
      );

      expect(response.statusCode).toBe(204);
      expect(
        (await call(app, host.token, 'GET', `/groups/${groupId}/themes/custom`)).json().themes,
      ).toEqual([]);
    });
  });
});
