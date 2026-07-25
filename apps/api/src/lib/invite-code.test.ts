import { describe, it, expect } from 'vitest';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, normaliseInviteCode } from '@aftergame/shared';
import { generateInviteCode } from './invite-code.js';

describe('invite codes', () => {
  it('is 8 characters of Crockford base32', () => {
    const code = generateInviteCode();

    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect([...code].every((character) => INVITE_CODE_ALPHABET.includes(character))).toBe(true);
  });

  it('never contains the letters that get misheard', () => {
    // I, L, O and U are excluded so a code read aloud cannot become a different valid code.
    for (let index = 0; index < 500; index += 1) {
      expect(generateInviteCode()).not.toMatch(/[ILOU]/);
    }
  });

  it('does not repeat in practice', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateInviteCode()));

    expect(codes.size).toBe(2000);
  });

  it('uses the whole alphabet', () => {
    // A generator with modulo bias, or an off-by-one on the mask, shows up as missing characters.
    const seen = new Set<string>();

    for (let index = 0; index < 2000; index += 1) {
      for (const character of generateInviteCode()) seen.add(character);
    }

    expect(seen.size).toBe(INVITE_CODE_ALPHABET.length);
  });

  it('distributes characters roughly evenly', () => {
    const counts = new Map<string, number>();
    const samples = 4000;

    for (let index = 0; index < samples; index += 1) {
      for (const character of generateInviteCode()) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }

    const expected = (samples * INVITE_CODE_LENGTH) / INVITE_CODE_ALPHABET.length;

    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });
});

describe('normaliseInviteCode', () => {
  it('uppercases and strips separators people add when reading aloud', () => {
    expect(normaliseInviteCode('abcd-2345')).toBe('ABCD2345');
    expect(normaliseInviteCode(' abcd 2345 ')).toBe('ABCD2345');
  });

  it.each([
    ['O typed for zero', 'ABCD23O5', 'ABCD2305'],
    ['I typed for one', 'ABCDI345', 'ABCD1345'],
    ['L typed for one', 'ABCDL345', 'ABCD1345'],
    ['U typed for V', 'ABCDU345', 'ABCDV345'],
  ])('folds %s', (_label, typed, expected) => {
    // Crockford's decoding rules exist for exactly this: the characters excluded from the
    // alphabet are the ones people substitute, so accepting them costs nothing and saves a
    // failed join.
    expect(normaliseInviteCode(typed)).toBe(expected);
  });

  it('leaves a correct code untouched', () => {
    const code = generateInviteCode();

    expect(normaliseInviteCode(code)).toBe(code);
  });
});
