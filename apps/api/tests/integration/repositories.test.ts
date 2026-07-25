import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { GroupRole, MembershipStatus, type PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { makeMember, makeUser } from '../helpers/factories.js';
import { createGroupsRepository } from '../../src/modules/groups/groups.repository.js';
import { createThemesRepository } from '../../src/modules/themes/themes.repository.js';
import { seedThemes, SYSTEM_THEMES } from '../../prisma/seed.js';

describe('repositories', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  describe('groups', () => {
    it('creates a group and its owner membership atomically', async () => {
      const repo = createGroupsRepository(prisma);
      const owner = await makeUser(prisma);

      const group = await repo.createWithOwner({ name: 'Friday Night', ownerId: owner.id });
      const membership = await repo.findMembership(group.id, owner.id);

      expect(group.name).toBe('Friday Night');
      expect(membership?.role).toBe(GroupRole.OWNER);
      expect(membership?.status).toBe(MembershipStatus.ACTIVE);
      expect(membership?.consecutivePunishments).toBe(0);
    });

    it('leaves no group behind when the owner membership cannot be created', async () => {
      const repo = createGroupsRepository(prisma);

      await expect(
        repo.createWithOwner({ name: 'Doomed', ownerId: crypto.randomUUID() }),
      ).rejects.toThrow();

      expect(await prisma.group.count()).toBe(0);
    });

    it('returns a group to its members', async () => {
      const repo = createGroupsRepository(prisma);
      const owner = await makeUser(prisma);
      const group = await repo.createWithOwner({ name: 'Ours', ownerId: owner.id });
      const { user: member } = await makeMember(prisma, group.id);

      expect(await repo.findByIdForMember(group.id, owner.id)).not.toBeNull();
      expect(await repo.findByIdForMember(group.id, member.id)).not.toBeNull();
    });

    it('hides a group from a non-member, so existence never leaks', async () => {
      const repo = createGroupsRepository(prisma);
      const owner = await makeUser(prisma);
      const outsider = await makeUser(prisma);
      const group = await repo.createWithOwner({ name: 'Private', ownerId: owner.id });

      // Null here is what the route turns into a 404 rather than a 403.
      expect(await repo.findByIdForMember(group.id, outsider.id)).toBeNull();
    });

    it('lists only the groups a user belongs to', async () => {
      const repo = createGroupsRepository(prisma);
      const alice = await makeUser(prisma);
      const bob = await makeUser(prisma);

      await repo.createWithOwner({ name: 'Alice one', ownerId: alice.id });
      await repo.createWithOwner({ name: 'Alice two', ownerId: alice.id });
      await repo.createWithOwner({ name: 'Bob only', ownerId: bob.id });

      const forAlice = await repo.listForUser(alice.id);

      expect(forAlice).toHaveLength(2);
      expect(forAlice.map((group) => group.name).sort()).toEqual(['Alice one', 'Alice two']);
    });

    it('counts members and excludes blocked players from the eligible roster', async () => {
      const repo = createGroupsRepository(prisma);
      const owner = await makeUser(prisma);
      const group = await repo.createWithOwner({ name: 'Roster', ownerId: owner.id });

      const { membership: blocked } = await makeMember(prisma, group.id);
      await makeMember(prisma, group.id);

      await prisma.groupMembership.update({
        where: { id: blocked.id },
        data: { consecutivePunishments: 3, status: MembershipStatus.GAME_BLOCKED },
      });

      // A blocked player keeps full group access (D7) — they are still a member…
      expect(await repo.countMembers(group.id)).toBe(3);
      // …but cannot be put on a roster.
      const eligible = await repo.listEligiblePlayers(group.id);
      expect(eligible).toHaveLength(2);
      expect(eligible.map((row) => row.id)).not.toContain(blocked.id);
    });

    it('works inside a transaction, so a service can compose several repositories', async () => {
      const owner = await makeUser(prisma);

      const group = await prisma.$transaction(async (tx) => {
        const repo = createGroupsRepository(tx);
        return repo.createWithOwner({ name: 'Transactional', ownerId: owner.id });
      });

      expect(
        await createGroupsRepository(prisma).findByIdForMember(group.id, owner.id),
      ).not.toBeNull();
    });

    it('rolls a whole transaction back on failure', async () => {
      const owner = await makeUser(prisma);

      await expect(
        prisma.$transaction(async (tx) => {
          const repo = createGroupsRepository(tx);
          await repo.createWithOwner({ name: 'Kept?', ownerId: owner.id });
          throw new Error('service failed after the write');
        }),
      ).rejects.toThrow('service failed after the write');

      expect(await prisma.group.count()).toBe(0);
    });
  });

  describe('themes', () => {
    it('seeds the three default themes', async () => {
      await seedThemes(prisma);
      const themes = await createThemesRepository(prisma).list();

      expect(themes.map((theme) => theme.slug)).toEqual(['questions', 'challenges', 'anecdotes']);
    });

    it('is idempotent — re-seeding never duplicates or renumbers', async () => {
      await seedThemes(prisma);
      const first = await createThemesRepository(prisma).list();

      await seedThemes(prisma);
      await seedThemes(prisma);
      const third = await createThemesRepository(prisma).list();

      expect(third).toHaveLength(SYSTEM_THEMES.length);
      // Same rows, not replacements: ids are stable across re-seeds.
      expect(third.map((theme) => theme.id)).toEqual(first.map((theme) => theme.id));
    });

    it('gives only Anecdotes the comment and guessing capabilities', async () => {
      await seedThemes(prisma);
      const repo = createThemesRepository(prisma);

      const anecdotes = await repo.findBySlug('anecdotes');
      const questions = await repo.findBySlug('questions');
      const challenges = await repo.findBySlug('challenges');

      expect(anecdotes).toMatchObject({ supportsComments: true, supportsAuthorGuess: true });
      expect(questions).toMatchObject({ supportsComments: false, supportsAuthorGuess: false });
      expect(challenges).toMatchObject({ supportsComments: false, supportsAuthorGuess: false });
    });

    it('marks seeded themes as system themes so they cannot be deleted as user content', async () => {
      await seedThemes(prisma);
      const themes = await createThemesRepository(prisma).list();

      expect(themes.every((theme) => theme.isSystem)).toBe(true);
    });

    it('updates copy on re-seed without demoting a system theme', async () => {
      await seedThemes(prisma);
      const repo = createThemesRepository(prisma);

      await repo.upsertSystemTheme({
        ...SYSTEM_THEMES[0]!,
        name: 'Questions, reworded',
      });

      const updated = await repo.findBySlug('questions');
      expect(updated?.name).toBe('Questions, reworded');
      expect(updated?.isSystem).toBe(true);
    });
  });
});
