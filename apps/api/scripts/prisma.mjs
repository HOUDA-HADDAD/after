/**
 * Run the Prisma CLI with the repository's `.env` loaded.
 *
 * Prisma looks for `.env` beside the schema or in the working directory, and this is a monorepo
 * with a single `.env` at the root — so `prisma migrate deploy` would otherwise fail with an
 * opaque "Validation Error Count: 1" on a fresh clone. That is a bad first five minutes for a
 * contributor, and the fix is four lines.
 *
 * Spawning the CLI through node rather than a shell also avoids the argument-escaping caveat
 * Node warns about when `shell: true` is combined with an argument array.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repoRootEnv = resolve(process.cwd(), '../../.env');
const localEnv = resolve(process.cwd(), '.env');

// Real environment variables always win; the file only fills in what is missing.
if (existsSync(repoRootEnv)) process.loadEnvFile(repoRootEnv);
else if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const prismaCli = resolve(
  dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
  'build/index.js',
);

const { status } = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(status ?? 1);
