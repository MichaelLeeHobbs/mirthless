// ===========================================
// Token hashing
// ===========================================
// How the server stores a secret it hands out: refresh tokens and API key
// secrets are kept only as their SHA-256 (RBAC plan section 7). Both are long
// random values, so a fast hash is enough; a password goes through bcrypt.

import { createHash, timingSafeEqual } from 'node:crypto';

/** The SHA-256 of `token`, as 64 hex characters. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether `token` hashes to `storedHash`, compared in constant time so the
 * time taken says nothing about how much of the hash matched.
 */
export function matchesTokenHash(token: string, storedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
