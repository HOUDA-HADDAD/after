import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load a `.env` file into `process.env`, if one exists.
 *
 * Deliberately an explicit call rather than an import side effect: the composition root decides
 * when configuration enters the process, so tests and production can skip it entirely. Production
 * hosts inject real environment variables and have no `.env` file at all, which is why a missing
 * file is a no-op rather than an error.
 *
 * Uses Node's built-in loader (22+), so this costs no dependency. Existing environment variables
 * always win — an explicitly exported value should never be overridden by a stale local file.
 */
export function loadEnvFileIfPresent(path = '.env'): boolean {
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) return false;

  process.loadEnvFile(absolute);
  return true;
}
