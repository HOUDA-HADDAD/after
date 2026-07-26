import type { FastifyInstance } from 'fastify';
import type { SessionStateDto } from '@aftergame/shared';
import { asUser, registerUser, type InjectResponse } from './auth.js';

export interface Player {
  token: string;
  userId: string;
  credentials: { username: string; email: string; password: string };
}

export interface GameFixture {
  groupId: string;
  sessionId: string;
  host: Player;
  players: Player[];
  /** Everyone, host first. */
  all: Player[];
}

/** Call the API as a signed-in user. */
export const call = (
  app: FastifyInstance,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
): Promise<InjectResponse> =>
  app.inject(
    asUser(token, {
      method,
      url: `/api/v1${url}`,
      ...(payload === undefined ? {} : { payload }),
    }),
  ) as Promise<InjectResponse>;

export const state = async (app: FastifyInstance, token: string, sessionId: string) =>
  (await call(app, token, 'GET', `/sessions/${sessionId}`)).json() as SessionStateDto;

/**
 * Find a theme by slug — the seed guarantees the three defaults exist.
 *
 * Group-scoped, because themes are: the list is the defaults plus whatever this group wrote (D19).
 */
export async function themeId(
  app: FastifyInstance,
  token: string,
  slug: string,
  groupId: string,
): Promise<string> {
  const themes = (await call(app, token, 'GET', `/groups/${groupId}/themes`)).json().themes as {
    id: string;
    slug: string;
  }[];

  const theme = themes.find((entry) => entry.slug === slug);
  if (theme === undefined) throw new Error(`Theme ${slug} is not seeded`);

  return theme.id;
}

/**
 * A group with `playerCount` members and a session in the lobby, everyone joined.
 *
 * The host is a player too — creating a game is not the same as sitting out of it.
 */
export async function makeLobby(
  app: FastifyInstance,
  playerCount: number,
  themeSlug = 'anecdotes',
): Promise<GameFixture> {
  const host = await registerUser(app);
  const groupId = (await call(app, host.token, 'POST', '/groups', { name: 'Friday Night' })).json()
    .id as string;

  const code = (await call(app, host.token, 'POST', `/groups/${groupId}/invitations`, {})).json()
    .code as string;

  const players: Player[] = [];

  for (let index = 1; index < playerCount; index += 1) {
    const player = await registerUser(app);
    await call(app, player.token, 'POST', '/join', { code });
    players.push(player);
  }

  const sessionId = (
    await call(app, host.token, 'POST', `/groups/${groupId}/sessions`, {
      themeId: await themeId(app, host.token, themeSlug, groupId),
    })
  ).json().id as string;

  for (const player of players) {
    await call(app, player.token, 'POST', `/sessions/${sessionId}/join`);
  }

  return { groupId, sessionId, host, players, all: [host, ...players] };
}

/** Everyone writes and submits one text. */
export async function everyoneWrites(app: FastifyInstance, game: GameFixture): Promise<void> {
  for (const [index, player] of game.all.entries()) {
    await call(app, player.token, 'POST', `/sessions/${game.sessionId}/text/submit`, {
      body: `Text number ${String(index)} — written by someone`,
    });
  }
}

/** Everyone answers every assignment they were given. */
export async function everyoneAnswers(app: FastifyInstance, game: GameFixture): Promise<void> {
  for (const [index, player] of game.all.entries()) {
    const view = await state(app, player.token, game.sessionId);

    for (const assignment of view.you?.assignments ?? []) {
      await call(
        app,
        player.token,
        'POST',
        `/sessions/${game.sessionId}/assignments/${assignment.assignmentId}/answer/submit`,
        { body: `Answer from player ${String(index)}` },
      );
    }
  }
}

/** Everyone casts the same reveal vote. */
export async function everyoneVotes(
  app: FastifyInstance,
  game: GameFixture,
  choice: 'YES' | 'NO',
): Promise<void> {
  for (const player of game.all) {
    await call(app, player.token, 'POST', `/sessions/${game.sessionId}/reveal-vote`, { choice });
  }
}
