import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFileIfPresent } from './dotenv.js';

describe('loadEnvFileIfPresent', () => {
  let dir: string;
  const touched: string[] = [];

  const setVar = (key: string, value: string): void => {
    touched.push(key);
    process.env[key] = value;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aftergame-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const key of touched.splice(0)) delete process.env[key];
  });

  it('loads values from a file into process.env', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'AFTERGAME_TEST_LOADED=from-file\n');
    touched.push('AFTERGAME_TEST_LOADED');

    expect(loadEnvFileIfPresent(file)).toBe(true);
    expect(process.env.AFTERGAME_TEST_LOADED).toBe('from-file');
  });

  it('is a no-op when the file does not exist', () => {
    // Production hosts inject real variables and ship no .env — that must not be an error.
    expect(loadEnvFileIfPresent(join(dir, 'nope.env'))).toBe(false);
  });

  it('does not let a stale local file override an explicitly exported variable', () => {
    setVar('AFTERGAME_TEST_PRECEDENCE', 'from-environment');

    const file = join(dir, '.env');
    writeFileSync(file, 'AFTERGAME_TEST_PRECEDENCE=from-file\n');

    loadEnvFileIfPresent(file);

    expect(process.env.AFTERGAME_TEST_PRECEDENCE).toBe('from-environment');
  });
});
