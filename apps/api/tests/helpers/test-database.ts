import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

export interface TestDatabase {
  url: string;
  /** Which tier provided it — surfaced in test output so a green run is never ambiguous. */
  kind: 'external' | 'embedded';
  stop(): Promise<void>;
}

const freePort = async (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not acquire a free port'));
        return;
      }
      const { port } = address;
      server.close(() => {
        resolvePort(port);
      });
    });
  });

/**
 * Delete the data directory, allowing for Windows.
 *
 * `server.stop()` resolves when the process exits, which is not the same as Windows having
 * released its file handles — so the very next `rmSync` can fail with EPERM. It shows up as a
 * suite that passes every assertion and then fails at teardown, most often when two suites run at
 * once and the machine is busy. A few short retries turn that into what it should have been: a
 * temporary directory going away a moment later.
 *
 * The directory is under the OS temp root, so giving up quietly is also correct — the worst case
 * is a few megabytes the operating system cleans up later.
 */
async function removeWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

/**
 * Start a PostgreSQL for the integration suite.
 *
 * Two tiers, in order:
 *
 *   1. `TEST_DATABASE_URL` — an already-running PostgreSQL. CI uses a Postgres 16 service
 *      container; locally this is what `docker compose up -d` gives you. Fastest, because
 *      nothing has to boot.
 *
 *   2. **Embedded PostgreSQL** — the official PostgreSQL 16 binaries, shipped as an npm package
 *      and run as a real server on a temporary data directory. No Docker, no admin rights, no
 *      global install; the directory is deleted on teardown.
 *
 * Both tiers are genuine PostgreSQL 16 speaking the real wire protocol, which is the point:
 * this suite exists to prove that constraints *reject* bad data, so anything that approximates
 * error behaviour is worse than useless. (An in-process WASM build was tried first and desynced
 * its connection after the first constraint violation — reporting later failures as successes.
 * A test harness that lies is the one thing worse than no harness.)
 *
 * See docs/08-testing.md.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL;

  if (external !== undefined && external !== '') {
    return { url: external, kind: 'external', stop: async () => {} };
  }

  // Imported lazily so tier 1 never pays to load the embedded server.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const dataDir = mkdtempSync(join(tmpdir(), 'aftergame-pg-'));
  const port = await freePort();
  const user = 'aftergame';
  const password = 'aftergame';

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: false,
    // initdb otherwise inherits the host locale — on a Windows machine that means a WIN1252
    // database, which rejects any non-Latin-1 character the moment a migration comment or a
    // player's answer contains one. Production is UTF-8 and C collation (see docker-compose.yml);
    // the test database must match or it tests a different PostgreSQL than we ship.
    initdbFlags: ['--encoding=UTF8', '--lc-collate=C', '--lc-ctype=C'],
  });

  await server.initialise();
  await server.start();
  await server.createDatabase('aftergame_test');

  return {
    url: `postgresql://${user}:${password}@127.0.0.1:${String(port)}/aftergame_test`,
    kind: 'embedded',
    async stop() {
      try {
        await server.stop();
      } finally {
        await removeWithRetry(dataDir);
      }
    },
  };
}
