import { describe, it, expect } from 'vitest';
import { createAttemptLimiter } from './attempt-limiter.js';

describe('attempt limiter', () => {
  it('allows up to max attempts, then refuses', () => {
    const limiter = createAttemptLimiter({ max: 3, windowMs: 1000 });

    expect(limiter.consume('sarah@example.com')).toBe(true);
    expect(limiter.consume('sarah@example.com')).toBe(true);
    expect(limiter.consume('sarah@example.com')).toBe(true);
    expect(limiter.consume('sarah@example.com')).toBe(false);
  });

  it('counts each key separately', () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: 1000 });

    expect(limiter.consume('sarah@example.com')).toBe(true);
    expect(limiter.consume('sarah@example.com')).toBe(false);
    // One account being attacked must not lock everyone else out.
    expect(limiter.consume('ahmed@example.com')).toBe(true);
  });

  it('opens a fresh window once the old one elapses', () => {
    const limiter = createAttemptLimiter({ max: 2, windowMs: 1000 });
    const start = 1_000_000;

    expect(limiter.consume('key', start)).toBe(true);
    expect(limiter.consume('key', start + 100)).toBe(true);
    expect(limiter.consume('key', start + 200)).toBe(false);

    expect(limiter.consume('key', start + 1001)).toBe(true);
  });

  it('forgets a key on reset, so one typo does not linger', () => {
    const limiter = createAttemptLimiter({ max: 2, windowMs: 60_000 });

    limiter.consume('key');
    limiter.consume('key');
    expect(limiter.consume('key')).toBe(false);

    limiter.reset('key');

    expect(limiter.consume('key')).toBe(true);
  });

  it('bounds memory when flooded with distinct keys', () => {
    // Otherwise an attacker submitting a million unique addresses is a memory exhaustion attack.
    const limiter = createAttemptLimiter({ max: 5, windowMs: 60_000, maxKeys: 100 });

    for (let index = 0; index < 5000; index += 1) {
      limiter.consume(`user${String(index)}@example.com`);
    }

    expect(limiter.size()).toBeLessThanOrEqual(100);
  });

  it('still limits the keys it is tracking after eviction', () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: 60_000, maxKeys: 10 });

    for (let index = 0; index < 50; index += 1) {
      limiter.consume(`user${String(index)}@example.com`);
    }

    const recent = 'user49@example.com';
    expect(limiter.consume(recent)).toBe(false);
  });
});
