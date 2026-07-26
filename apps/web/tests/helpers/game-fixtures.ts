import { vi } from 'vitest';
import type {
  GroupDetailDto,
  SessionPhaseDto,
  SessionStateDto,
  SessionSummaryDto,
  SessionThemeDto,
  TimelineDto,
  ViewerStateDto,
} from '@aftergame/shared';

/* ---- the pieces ---------------------------------------------------------------------------- */

export const ANECDOTES: SessionThemeDto = {
  id: 'theme-1',
  slug: 'anecdotes',
  name: 'Anecdotes',
  description: 'Tell us about your funniest childhood memory.',
  writePrompt: 'Write your anecdote',
  writePlaceholder: 'I once tried to…',
  answerPrompt: 'What do you say to this?',
  icon: '🎭',
  supportsComments: true,
  supportsAuthorGuess: true,
  isSystem: true,
  isCustom: false,
};

export const VIEWER_USER_ID = 'user-sarah';

export const viewer = (overrides: Partial<ViewerStateDto> = {}): ViewerStateDto => ({
  playerId: 'p1',
  isHost: false,
  draftText: '',
  textSubmitted: false,
  assignments: [],
  revealVoteCast: false,
  ...overrides,
});

export function makeGroup(overrides: Partial<GroupDetailDto> = {}): GroupDetailDto {
  return {
    id: 'g1',
    name: 'Friday Night',
    memberCount: 3,
    viewerRole: 'OWNER',
    createdAt: '2026-07-01T00:00:00.000Z',
    members: [
      {
        userId: VIEWER_USER_ID,
        username: 'sarah',
        role: 'OWNER',
        status: 'ACTIVE',
        consecutivePunishments: 0,
        joinedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        userId: 'user-ahmed',
        username: 'ahmed',
        role: 'MEMBER',
        status: 'ACTIVE',
        consecutivePunishments: 2,
        joinedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        userId: 'user-lina',
        username: 'lina',
        role: 'MEMBER',
        status: 'ACTIVE',
        consecutivePunishments: 0,
        joinedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

/**
 * A game in whatever phase the test needs.
 *
 * Built from the same DTO the server sends, so a test can only assert on data the projection
 * would actually have produced. In particular an anonymous author is `null` here exactly as it is
 * on the wire — a fixture that carried the name and trusted the component to hide it would test
 * the opposite of the property we care about.
 */
export function makeSession(
  phase: SessionPhaseDto,
  overrides: Partial<SessionStateDto> = {},
): SessionStateDto {
  return {
    id: 's1',
    groupId: 'g1',
    phase,
    theme: ANECDOTES,
    players: [
      { playerId: 'p1', username: 'sarah', isYou: true, hasLeft: false, answerLoad: 1 },
      { playerId: 'p2', username: 'ahmed', isYou: false, hasLeft: false, answerLoad: 3 },
      { playerId: 'p3', username: 'lina', isYou: false, hasLeft: false, answerLoad: 1 },
    ],
    progress: { submitted: 0, required: 3 },
    you: viewer(),
    reveal: null,
    timeline: null,
    purgeAfter: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** An anonymous timeline: two texts, one of them answered twice by a punished player. */
export function makeTimeline(overrides: Partial<TimelineDto> = {}): TimelineDto {
  return {
    authorsVisible: false,
    texts: [
      {
        id: 't1',
        body: 'I once tried to bake a cake in a toaster.',
        author: null,
        yourGuess: null,
        yourGuessCorrect: null,
        answers: [
          {
            id: 'a1',
            body: 'Respect for the ambition.',
            author: null,
            skipped: false,
            reactions: [],
            comments: [
              {
                id: 'c1',
                body: 'That is hilarious.',
                author: null,
                createdAt: '2026-07-01T00:00:00.000Z',
              },
              {
                id: 'c2',
                body: 'I think I know who wrote this.',
                author: { playerId: 'p1', username: 'sarah' },
                createdAt: '2026-07-01T00:01:00.000Z',
              },
            ],
          },
          {
            id: 'a2',
            body: 'My cousin dared me to do the same.',
            author: null,
            skipped: false,
            comments: [],
            reactions: [],
          },
        ],
      },
      {
        id: 't2',
        body: 'I got lost in a supermarket for two hours.',
        author: null,
        yourGuess: null,
        yourGuessCorrect: null,
        answers: [
          { id: 'a3', body: null, author: null, skipped: true, comments: [], reactions: [] },
        ],
      },
    ],
    guessScores: null,
    ...overrides,
  };
}

/* ---- the stub ------------------------------------------------------------------------------ */

export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

export interface ApiStub {
  calls: RecordedCall[];
  /** Replace what the server will report from now on. */
  setSession: (next: SessionStateDto) => void;
  session: () => SessionStateDto;
  /** The most recent call whose URL contains `fragment`, for asserting what was sent. */
  lastCall: (fragment: string) => RecordedCall | undefined;
}

export interface StubOptions {
  session?: SessionStateDto;
  group?: GroupDetailDto;
  themes?: SessionThemeDto[];
  liveSession?: SessionSummaryDto | null;
}

/**
 * Stub the network at `fetch`, so the real client, query layer and components all run.
 *
 * Every mutating call answers with the current session state, which is what the API does — that
 * is what lets a test drive a phase change by writing to the stub and letting the component
 * re-render from the response rather than from anything it kept locally.
 */
export function installApiStub({
  session = makeSession('LOBBY'),
  group = makeGroup(),
  themes = [ANECDOTES],
  liveSession = null,
}: StubOptions = {}): ApiStub {
  let current = session;
  const calls: RecordedCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body));

      calls.push({ method, url, body });

      const json = (payload: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(payload), { status }));

      if (url.endsWith('/auth/me')) {
        return json({
          user: { id: VIEWER_USER_ID, username: 'sarah', email: 's@x.com', createdAt: '' },
        });
      }

      if (url.endsWith('/themes')) return json({ themes });
      if (url.endsWith('/session')) return json({ session: liveSession });
      if (url.endsWith('/groups')) return json({ groups: [group] });
      if (/\/groups\/[^/]+$/.test(url)) return json(group);

      // Everything under /sessions answers with the game, which is what the API does.
      if (url.includes('/sessions/')) return json(current);

      return json({});
    }),
  );

  return {
    calls,
    session: () => current,
    setSession: (next) => {
      current = next;
    },
    lastCall: (fragment) => [...calls].reverse().find((call) => call.url.includes(fragment)),
  };
}
