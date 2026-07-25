import { describe, it, expect } from 'vitest';
import { loadEnv, EnvValidationError, EXAMPLE_SESSION_SECRET } from './index.js';

const base = {
  DATABASE_URL: 'postgresql://app:pw@localhost:5432/aftergame',
  SESSION_SECRET: 'x'.repeat(32),
} satisfies NodeJS.ProcessEnv;

describe('loadEnv', () => {
  it('applies documented defaults', () => {
    const env = loadEnv({ ...base });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_GRACE_HOURS).toBe(24);
    expect(env.ARGON2_MEMORY_KIB).toBe(19456);
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('coerces numeric and boolean strings', () => {
    const env = loadEnv({ ...base, PORT: '8080', RATE_LIMIT_ENABLED: 'false' });

    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_ENABLED).toBe(false);
  });

  it('refuses to start without a database URL', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = base;

    expect(() => loadEnv(withoutDb)).toThrow(EnvValidationError);
  });

  it('rejects a short session secret', () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('rejects the example secret in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://aftergame.example.com',
        SESSION_SECRET: EXAMPLE_SESSION_SECRET,
      }),
    ).toThrow(/example value/);
  });

  it('allows the example secret outside production', () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: EXAMPLE_SESSION_SECRET })).not.toThrow();
  });

  it('requires https in production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', APP_ORIGIN: 'http://insecure.example.com' }),
    ).toThrow(/https in production/);
  });

  it('reports every problem at once, not just the first', () => {
    try {
      loadEnv({ DATABASE_URL: 'not-a-url', SESSION_SECRET: 'short' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
