import { randomBytes } from 'node:crypto';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@aftergame/shared';

const ALPHABET_SIZE = INVITE_CODE_ALPHABET.length; // 32

/**
 * Generate a room code.
 *
 * Crockford base32: no I, L, O or U, so a code read aloud across a noisy room cannot be
 * misheard into a different valid code. 8 characters is 40 bits — combined with the rate limit
 * on redemption, guessing one is not a viable attack.
 *
 * Rejection sampling rather than `% 32` because the alphabet is exactly 32 characters and a
 * byte is 256 values: the modulo would be unbiased here by luck, and would silently stop being
 * unbiased the day someone changes the alphabet. Masking to 5 bits keeps it correct by
 * construction.
 */
export function generateInviteCode(length: number = INVITE_CODE_LENGTH): string {
  let code = '';

  while (code.length < length) {
    for (const byte of randomBytes(length)) {
      const index = byte & 0b11111;
      if (index >= ALPHABET_SIZE) continue;

      code += INVITE_CODE_ALPHABET[index];
      if (code.length === length) break;
    }
  }

  return code;
}
