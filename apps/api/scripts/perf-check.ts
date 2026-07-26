import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import autocannon from 'autocannon';
import { loadEnv } from '@aftergame/config';
import { SESSION_COOKIE_NAME_INSECURE } from '@aftergame/shared';
import { buildApp } from '../src/app.js';
import { seedThemes } from '../prisma/seed.js';
import { startTestDatabase, type TestDatabase } from '../tests/helpers/test-database.js';

/**
 * The load and index review.
 *
 * Builds a game at the size the design actually allows — `MAX_SESSION_PLAYERS`, every player
 * punished to the maximum, a comment on every answer — and then does two things with it:
 *
 *   1. Fires `autocannon` at the timeline read, which is the hot endpoint: it is the largest
 *      projection in the app and the one every player refreshes while the table talks.
 *   2. Captures the SQL Prisma actually issued for that read and runs `EXPLAIN (ANALYZE, BUFFERS)`
 *      over each statement, reporting any sequential scan on a table with rows in it.
 *
 * Budget: p95 under 150 ms on the timeline read (docs/08-testing.md).
 */

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PERF_PORT ?? 3210);
const PLAYERS = 30;

const prismaCli = (): string =>
  resolve(dirname(createRequire(import.meta.url).resolve('prisma/package.json')), 'build/index.js');

let database: TestDatabase | undefined;

interface CapturedQuery {
  sql: string;
  params: string;
  duration: number;
}

async function main(): Promise<void> {
  database = await startTestDatabase();

  execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: database.url },
    stdio: 'inherit',
  });

  const queries: CapturedQuery[] = [];
  let capturing = false;

  const prisma = new PrismaClient({
    datasources: { db: { url: database.url } },
    log: [{ emit: 'event', level: 'query' }],
  });

  prisma.$on('query', (event) => {
    if (capturing)
      queries.push({ sql: event.query, params: event.params, duration: event.duration });
  });

  await seedThemes(prisma);

  const env = loadEnv({
    NODE_ENV: 'development',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    APP_ORIGIN: `http://127.0.0.1:${String(PORT)}`,
    DATABASE_URL: database.url,
    SESSION_SECRET: 'perf-session-secret-at-least-32-characters',
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_TIME_COST: '1',
    MAX_SESSION_PLAYERS: String(PLAYERS),
  });

  const app = await buildApp({ env, prismaClient: prisma });
  await app.listen({ port: PORT, host: '127.0.0.1' });

  /* ---- a full-size game ------------------------------------------------------------------- */

  console.warn(`[perf] building a ${String(PLAYERS)}-player game…`);

  const tokens: string[] = [];

  for (let index = 0; index < PLAYERS; index += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `perf${String(index)}`,
        email: `perf${String(index)}@example.com`,
        password: 'a decently long passphrase',
      },
    });

    const token = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME_INSECURE)?.value;

    if (token === undefined) throw new Error(`registration ${String(index)} set no cookie`);

    tokens.push(token);
  }

  const call = (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { cookie: `${SESSION_COOKIE_NAME_INSECURE}=${token}` },
      ...(payload === undefined ? {} : { payload }),
    });

  const host = tokens[0]!;
  const groupId = ((await call(host, 'POST', '/groups', { name: 'Perf' })).json() as { id: string })
    .id;
  const code = (
    (
      await call(host, 'POST', `/groups/${groupId}/invitations`, {
        expiresInHours: null,
        maxUses: null,
      })
    ).json() as { code: string }
  ).code;

  for (const token of tokens.slice(1)) await call(token, 'POST', '/join', { code });

  // A third of the table on the maximum load, which is the shape the distributor works hardest on
  // and the one that produces several answers under a single text.
  const members = (await call(host, 'GET', `/groups/${groupId}`)).json() as {
    members: { userId: string; username: string }[];
  };

  for (const member of members.members.slice(0, Math.floor(PLAYERS / 3))) {
    for (let level = 0; level < 2; level += 1) {
      await call(host, 'POST', `/groups/${groupId}/members/${member.userId}/punish`, {});
    }
  }

  const themes = (await call(host, 'GET', '/themes')).json() as {
    themes: { id: string; slug: string }[];
  };
  const themeId = themes.themes.find((theme) => theme.slug === 'anecdotes')!.id;

  const sessionId = (
    (await call(host, 'POST', `/groups/${groupId}/sessions`, { themeId })).json() as { id: string }
  ).id;

  for (const token of tokens.slice(1)) await call(token, 'POST', `/sessions/${sessionId}/join`);
  await call(host, 'POST', `/sessions/${sessionId}/start`);

  for (const [index, token] of tokens.entries()) {
    await call(token, 'POST', `/sessions/${sessionId}/text/submit`, {
      body: `Text number ${String(index)}. ${'A memory worth telling. '.repeat(8)}`,
    });
  }

  for (const token of tokens) {
    const state = (await call(token, 'GET', `/sessions/${sessionId}`)).json() as {
      you: { assignments: { assignmentId: string }[] };
    };

    for (const assignment of state.you.assignments) {
      await call(
        token,
        'POST',
        `/sessions/${sessionId}/assignments/${assignment.assignmentId}/answer/submit`,
        {
          body: `An answer of a realistic length. ${'Words and more words. '.repeat(6)}`,
        },
      );
    }
  }

  // Discussion: a comment from everyone on the first few answers, and a guess per text.
  const timeline = (await call(host, 'GET', `/sessions/${sessionId}`)).json() as {
    timeline: { texts: { id: string; answers: { id: string }[] }[] };
    players: { playerId: string; isYou: boolean }[];
  };

  for (const text of timeline.timeline.texts.slice(0, 10)) {
    for (const answer of text.answers) {
      for (const token of tokens.slice(0, 10)) {
        await call(token, 'POST', `/sessions/${sessionId}/answers/${answer.id}/comments`, {
          body: 'A comment of the length people actually write.',
          isAnonymous: true,
        });
      }
    }
  }

  const other = timeline.players.find((player) => !player.isYou)!.playerId;

  for (const text of timeline.timeline.texts) {
    await call(host, 'PUT', `/sessions/${sessionId}/texts/${text.id}/guess`, {
      guessedPlayerId: other,
    });
  }

  const counts = {
    texts: await prisma.gameText.count({ where: { sessionId } }),
    answers: await prisma.answer.count({ where: { sessionId } }),
    comments: await prisma.comment.count({ where: { sessionId } }),
    assignments: await prisma.textAssignment.count({ where: { sessionId } }),
  };

  console.warn(`[perf] game built: ${JSON.stringify(counts)}`);

  /* ---- the load check ---------------------------------------------------------------------- */

  const result = await autocannon({
    url: `http://127.0.0.1:${String(PORT)}/api/v1/sessions/${sessionId}`,
    headers: { cookie: `${SESSION_COOKIE_NAME_INSECURE}=${host}` },
    connections: 20,
    duration: 10,
  });

  console.warn('\n[perf] GET /sessions/:id — the timeline read');
  console.warn(`  requests/sec  ${String(Math.round(result.requests.average))}`);
  console.warn(`  latency p50   ${String(result.latency.p50)} ms`);
  console.warn(`  latency p95   ${String(result.latency.p97_5)} ms (p97.5)`);
  console.warn(`  latency max   ${String(result.latency.max)} ms`);
  console.warn(`  non-2xx       ${String(result.non2xx)}`);

  /* ---- the index review -------------------------------------------------------------------- */

  capturing = true;
  await call(host, 'GET', `/sessions/${sessionId}`);
  capturing = false;

  const unique = new Map<string, CapturedQuery>();

  for (const query of queries) {
    if (!query.sql.startsWith('SELECT')) continue;

    const existing = unique.get(query.sql);

    if (existing === undefined || query.duration > existing.duration) unique.set(query.sql, query);
  }

  console.warn(
    `\n[perf] EXPLAIN over ${String(unique.size)} distinct SELECTs from one timeline read`,
  );

  const seqScans: string[] = [];

  for (const query of unique.values()) {
    // Parameters are logged separately, and Prisma renders byte parameters in a form that is not
    // JSON — those statements are skipped rather than guessed at.
    let parameters: unknown[];

    try {
      parameters = JSON.parse(query.params) as unknown[];
    } catch {
      continue;
    }

    const sql = query.sql.replace(/\$\d+/g, (match) => {
      const value = parameters[Number(match.slice(1)) - 1];

      if (value === null || value === undefined) return 'NULL';

      return typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : String(value);
    });

    try {
      const plan = (await prisma.$queryRawUnsafe(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
      )) as { 'QUERY PLAN': unknown }[];

      const text = JSON.stringify(plan[0]?.['QUERY PLAN'] ?? {});
      const scans = [
        ...text.matchAll(/"Node Type":"Seq Scan","Parallel Aware":\w+,"Relation Name":"([^"]+)"/g),
      ];

      for (const scan of scans) {
        const table = scan[1] ?? '?';
        const counted = (await prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM "${table}"`,
        )) as { n: number }[];
        const rows = counted[0]?.n ?? 0;

        // A sequential scan over a handful of rows is the right plan — the planner is not wrong
        // to skip an index on 30 rows. Over a big table it is a missing index.
        if (rows > 200) seqScans.push(`${table} (${String(rows)} rows): ${query.sql.slice(0, 90)}`);
      }
    } catch (error) {
      console.warn(`  could not explain: ${String(error).slice(0, 120)}`);
    }
  }

  if (seqScans.length === 0) {
    console.warn('  no sequential scan over a table with more than 200 rows');
  } else {
    console.warn('  sequential scans worth an index:');
    for (const scan of seqScans) console.warn(`    ${scan}`);
  }

  const slowest = [...unique.values()].sort((a, b) => b.duration - a.duration).slice(0, 5);

  console.warn('\n[perf] slowest statements in one timeline read');
  for (const query of slowest) {
    console.warn(`  ${String(query.duration)} ms  ${query.sql.slice(0, 110)}`);
  }

  await app.close();
  await prisma.$disconnect();
  await database.stop();
}

main().catch(async (error: unknown) => {
  console.error('[perf] failed', error);
  await database?.stop();
  process.exit(1);
});
