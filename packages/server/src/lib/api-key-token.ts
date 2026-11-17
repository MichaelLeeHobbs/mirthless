// ===========================================
// API key tokens
// ===========================================
// The text a machine caller sends (D-313): gf_<keyId>_<secret>, where keyId is
// the key's UUID and secret is 256 random bits in base64url. The id finds the
// row; only the secret's hash is stored (lib/token-hash.ts).

import { randomBytes } from 'node:crypto';

const PREFIX = 'gf_';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 32 bytes in base64url without padding. */
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** A new secret: 256 random bits. */
export function newKeySecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The token a caller sends for key `keyId` with `secret`. */
export function keyToken(keyId: string, secret: string): string {
  return `${PREFIX}${keyId}_${secret}`;
}

/** Whether `token` is shaped like a key token, to tell it from a JWT before any lookup. */
export function looksLikeKeyToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

/** The key id and secret in `token`, or null when it is not a well-formed key token. */
export function parseKeyToken(token: string): { readonly keyId: string; readonly secret: string } | null {
  if (!token.startsWith(PREFIX)) return null;
  // The id is 36 characters with no underscore; the secret may hold underscores.
  const keyId = token.slice(PREFIX.length, PREFIX.length + 36);
  const rest = token.slice(PREFIX.length + 36);
  if (!UUID.test(keyId) || !rest.startsWith('_')) return null;
  const secret = rest.slice(1);
  return SECRET.test(secret) ? { keyId, secret } : null;
}
