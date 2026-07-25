import { randomUUID } from 'node:crypto';
import {
  ContentStatus,
  GroupRole,
  MembershipStatus,
  SessionStatus,
  type GameSession,
  type GamePlayer,
  type GameText,
  type Group,
  type GroupMembership,
  type PrismaClient,
  type Theme,
  type User,
} from '@prisma/client';

/**
 * Test data builders.
 *
 * Every factory takes only what the test actually cares about and invents the rest, so a test
 * reads as the thing it is asserting rather than as twenty lines of setup.
 */

const unique = (): string => randomUUID().slice(0, 8);

export async function makeUser(
  prisma: PrismaClient,
  overrides: Partial<Pick<User, 'username' | 'email' | 'passwordHash'>> = {},
): Promise<User> {
  const suffix = unique();

  return prisma.user.create({
    data: {
      username: overrides.username ?? `player_${suffix}`,
      email: overrides.email ?? `player_${suffix}@example.com`,
      // Phase 2 replaces this with a real argon2id hash; nothing here authenticates.
      passwordHash: overrides.passwordHash ?? `not-a-real-hash-${suffix}`,
    },
  });
}

export async function makeGroup(
  prisma: PrismaClient,
  ownerId: string,
  name = `Group ${unique()}`,
): Promise<Group> {
  return prisma.group.create({
    data: {
      name,
      ownerId,
      memberships: {
        create: { userId: ownerId, role: GroupRole.OWNER, status: MembershipStatus.ACTIVE },
      },
    },
  });
}

export async function makeMember(
  prisma: PrismaClient,
  groupId: string,
  role: GroupRole = GroupRole.MEMBER,
): Promise<{ user: User; membership: GroupMembership }> {
  const user = await makeUser(prisma);
  const membership = await prisma.groupMembership.create({
    data: { groupId, userId: user.id, role },
  });

  return { user, membership };
}

export async function makeTheme(
  prisma: PrismaClient,
  overrides: Partial<Pick<Theme, 'slug' | 'supportsComments' | 'supportsAuthorGuess'>> = {},
): Promise<Theme> {
  const slug = overrides.slug ?? `theme-${unique()}`;

  return prisma.theme.create({
    data: {
      slug,
      name: `Theme ${slug}`,
      description: 'A theme used in tests.',
      writePrompt: 'Write something',
      writePlaceholder: 'For example…',
      answerPrompt: 'Answer something',
      icon: 'circle',
      supportsComments: overrides.supportsComments ?? false,
      supportsAuthorGuess: overrides.supportsAuthorGuess ?? false,
    },
  });
}

export interface AnswerableSession {
  group: Group;
  theme: Theme;
  session: GameSession;
  players: GamePlayer[];
  texts: GameText[];
}

/**
 * A session with a locked roster of `playerCount` players, each having authored one text.
 *
 * "One text per player" is the default rule (D1); punishment changes how many texts a player
 * *receives*, never how many they write — which is why this factory always creates exactly one
 * text per player.
 */
export async function makeAnswerableSession(
  prisma: PrismaClient,
  playerCount: number,
  options: { withTexts?: boolean; status?: SessionStatus } = {},
): Promise<AnswerableSession> {
  const { withTexts = true, status = SessionStatus.ANSWERING } = options;

  const owner = await makeUser(prisma);
  const group = await makeGroup(prisma, owner.id);
  const theme = await makeTheme(prisma);

  const session = await prisma.gameSession.create({
    data: {
      groupId: group.id,
      themeId: theme.id,
      createdById: owner.id,
      status,
      requiredTextCount: playerCount,
    },
  });

  const players: GamePlayer[] = [];
  const memberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
  const ownerMembership = memberships[0]!;

  players.push(
    await prisma.gamePlayer.create({
      data: { sessionId: session.id, userId: owner.id, membershipId: ownerMembership.id },
    }),
  );

  for (let index = 1; index < playerCount; index += 1) {
    const { user, membership } = await makeMember(prisma, group.id);
    players.push(
      await prisma.gamePlayer.create({
        data: { sessionId: session.id, userId: user.id, membershipId: membership.id },
      }),
    );
  }

  const texts: GameText[] = [];

  if (withTexts) {
    for (const [index, player] of players.entries()) {
      texts.push(
        await prisma.gameText.create({
          data: {
            sessionId: session.id,
            authorPlayerId: player.id,
            body: `Text written by player ${String(index)}`,
            status: ContentStatus.SUBMITTED,
            displayOrder: index,
          },
        }),
      );
    }
  }

  return { group, theme, session, players, texts };
}
