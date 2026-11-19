// Refresh tokens and API key secrets are long random values, so a fast hash is
// enough; a password goes through bcrypt.

import { createHash, timingSafeEqual } from 'node:crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant time, so the time taken says nothing about how much of the hash matched. */
export function matchesTokenHash(token: string, storedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
