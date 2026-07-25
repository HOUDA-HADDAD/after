import { describe, it, expect } from 'vitest';
import { loginSchema, registerSchema } from './auth.js';

const valid = {
  username: 'sarah_p',
  email: 'sarah@example.com',
  password: 'a decently long passphrase',
};

describe('registerSchema', () => {
  it('accepts a well-formed registration', () => {
    expect(registerSchema.parse(valid)).toEqual(valid);
  });

  it('trims surrounding whitespace', () => {
    const parsed = registerSchema.parse({
      ...valid,
      username: '  sarah_p  ',
      email: ' sarah@example.com ',
    });

    expect(parsed.username).toBe('sarah_p');
    expect(parsed.email).toBe('sarah@example.com');
  });

  it('preserves email case, because citext handles uniqueness', () => {
    // Rewriting the local part of someone's address is not ours to do — RFC 5321 makes it
    // case-sensitive — and the database column is already case-insensitive for uniqueness.
    expect(registerSchema.parse({ ...valid, email: 'Sarah@Example.com' }).email).toBe(
      'Sarah@Example.com',
    );
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'x'.repeat(33)],
    ['a space', 'sarah p'],
    ['an @ sign', 'sarah@p'],
    ['empty', ''],
  ])('rejects a username that is %s', (_label, username) => {
    expect(registerSchema.safeParse({ ...valid, username }).success).toBe(false);
  });

  it.each([['sarah.p'], ['sarah-p'], ['sarah_p'], ['Sarah99']])(
    'accepts the username %s',
    (username) => {
      expect(registerSchema.safeParse({ ...valid, username }).success).toBe(true);
    },
  );

  it.each([['no-at-sign'], ['@example.com'], ['sarah@'], ['']])('rejects the email %s', (email) => {
    expect(registerSchema.safeParse({ ...valid, email }).success).toBe(false);
  });

  it('requires a password of at least 10 characters', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'nine char' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'ten chars!' }).success).toBe(true);
  });

  it('rejects passwords from the top of every breach list', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'password123' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'PASSWORD123' }).success).toBe(false);
  });

  it('does not impose composition rules', () => {
    // Length beats "one uppercase, one digit, one symbol", which just produces Password1!
    expect(registerSchema.safeParse({ ...valid, password: 'all lower case words' }).success).toBe(
      true,
    );
  });

  it('reports every problem at once', () => {
    const result = registerSchema.safeParse({ username: 'a', email: 'nope', password: 'short' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(new Set(result.error.issues.map((issue) => issue.path[0]))).toEqual(
        new Set(['username', 'email', 'password']),
      );
    }
  });
});

describe('loginSchema', () => {
  it('accepts any non-empty credentials', () => {
    expect(loginSchema.safeParse({ email: 'sarah@example.com', password: 'x' }).success).toBe(true);
  });

  it('does not apply password strength rules', () => {
    // An old password that no longer meets current policy must still be able to sign in — and a
    // strength error here would tell an attacker their guess was merely too weak.
    expect(
      loginSchema.safeParse({ email: 'sarah@example.com', password: 'password123' }).success,
    ).toBe(true);
  });

  it('rejects empty fields', () => {
    expect(loginSchema.safeParse({ email: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'sarah@example.com', password: '' }).success).toBe(false);
  });
});
