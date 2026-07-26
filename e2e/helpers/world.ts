import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';

/**
 * Setting up a game takes registration, a group, invitations and joins — none of which is what a
 * given spec is about. All of it goes through the real HTTP API rather than the UI, so a spec
 * spends its time on the behaviour it names.
 *
 * The one thing never done through the API is the thing under test.
 */

export interface Player {
  name: string;
  email: string;
  password: string;
  context: BrowserContext;
  page: Page;
}

let counter = 0;

/** Unique per run, so a re-run against the same database does not collide on the unique index. */
export const uniqueName = (prefix: string): string => {
  counter += 1;

  return `${prefix}${String(Date.now()).slice(-6)}${String(counter)}`;
};

/**
 * The device the running project describes.
 *
 * Contexts made by hand do not inherit the project's `use` block, so a spec that opens three of
 * them would silently run all three at desktop size — including in the mobile project, where that
 * is the whole point. Only context options are copied; the rest of `use` belongs to the runner.
 */
function projectContextOptions(): BrowserContextOptions {
  const use = test.info().project.use;

  return {
    ...(use.viewport === undefined ? {} : { viewport: use.viewport }),
    ...(use.userAgent === undefined ? {} : { userAgent: use.userAgent }),
    ...(use.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: use.deviceScaleFactor }),
    ...(use.isMobile === undefined ? {} : { isMobile: use.isMobile }),
    ...(use.hasTouch === undefined ? {} : { hasTouch: use.hasTouch }),
    ...(use.baseURL === undefined ? {} : { baseURL: use.baseURL }),
  };
}

/** Register through the API and return a context that carries the resulting session cookie. */
export async function signUp(browser: Browser, prefix: string): Promise<Player> {
  const name = uniqueName(prefix);
  const email = `${name}@example.com`;
  const password = 'a decently long passphrase';

  const context = await browser.newContext(projectContextOptions());
  const response = await context.request.post('/api/v1/auth/register', {
    data: { username: name, email, password },
  });

  expect(response.status(), await response.text()).toBe(201);

  const page = await context.newPage();

  return { name, email, password, context, page };
}

export const api = (player: Player): APIRequestContext => player.context.request;

export async function createGroup(owner: Player, name = 'Friday Night'): Promise<string> {
  const response = await api(owner).post('/api/v1/groups', { data: { name } });

  expect(response.status(), await response.text()).toBe(201);

  return ((await response.json()) as { id: string }).id;
}

export async function inviteCode(owner: Player, groupId: string): Promise<string> {
  const response = await api(owner).post(`/api/v1/groups/${groupId}/invitations`, {
    data: { expiresInHours: null, maxUses: null },
  });

  expect(response.status(), await response.text()).toBe(201);

  return ((await response.json()) as { code: string }).code;
}

export async function joinGroup(player: Player, code: string): Promise<void> {
  const response = await api(player).post('/api/v1/join', { data: { code } });

  expect(response.status(), await response.text()).toBe(200);
}

/** A group with everyone already in it. */
export async function assembleGroup(owner: Player, others: Player[]): Promise<string> {
  const groupId = await createGroup(owner);
  const code = await inviteCode(owner, groupId);

  for (const player of others) await joinGroup(player, code);

  return groupId;
}

export async function punish(owner: Player, groupId: string, target: Player): Promise<void> {
  const members = await api(owner).get(`/api/v1/groups/${groupId}`);
  const detail = (await members.json()) as { members: { userId: string; username: string }[] };
  const member = detail.members.find((entry) => entry.username === target.name);

  if (member === undefined) throw new Error(`${target.name} is not in the group`);

  const response = await api(owner).post(
    `/api/v1/groups/${groupId}/members/${member.userId}/punish`,
    { data: {} },
  );

  expect(response.status(), await response.text()).toBe(200);
}

export async function anecdotesThemeId(player: Player, groupId: string): Promise<string> {
  const response = await api(player).get(`/api/v1/groups/${groupId}/themes`);
  const { themes } = (await response.json()) as { themes: { id: string; slug: string }[] };
  const theme = themes.find((entry) => entry.slug === 'anecdotes');

  if (theme === undefined) throw new Error('the seed did not produce the Anecdotes theme');

  return theme.id;
}

/** The theme's own prompts, so specs never hard-code copy that belongs to a database row (D15). */
export async function anecdotesPrompts(
  player: Player,
  groupId: string,
): Promise<{ write: string; answer: string; name: string }> {
  const response = await api(player).get(`/api/v1/groups/${groupId}/themes`);
  const { themes } = (await response.json()) as {
    themes: { slug: string; name: string; writePrompt: string; answerPrompt: string }[];
  };
  const theme = themes.find((entry) => entry.slug === 'anecdotes');

  if (theme === undefined) throw new Error('the seed did not produce the Anecdotes theme');

  return { write: theme.writePrompt, answer: theme.answerPrompt, name: theme.name };
}

export async function openGame(owner: Player, groupId: string): Promise<string> {
  const themeId = await anecdotesThemeId(owner, groupId);
  const response = await api(owner).post(`/api/v1/groups/${groupId}/sessions`, {
    data: { themeId },
  });

  expect(response.status(), await response.text()).toBe(201);

  return ((await response.json()) as { id: string }).id;
}

export async function joinGame(player: Player, sessionId: string): Promise<void> {
  const response = await api(player).post(`/api/v1/sessions/${sessionId}/join`);

  expect(response.status(), await response.text()).toBe(200);
}

export async function startGame(owner: Player, sessionId: string): Promise<void> {
  const response = await api(owner).post(`/api/v1/sessions/${sessionId}/start`);

  expect(response.status(), await response.text()).toBe(200);
}

export const gameUrl = (groupId: string, sessionId: string): string =>
  `/groups/${groupId}/games/${sessionId}`;

/** Close every context a spec opened. */
export async function closeAll(players: Player[]): Promise<void> {
  for (const player of players) await player.context.close();
}
