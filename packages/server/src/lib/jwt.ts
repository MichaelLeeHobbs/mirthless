import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/index.js';

export interface JwtPayload {
  userId: string;
  sessionId?: string;
  type: 'access' | 'refresh';
}

// Pinned on sign and verify: without an `algorithms` allowlist jwt.verify accepts
// any algorithm in the token header (a forged `alg: none`, HS/RS confusion).
const JWT_ALGORITHM = 'HS256' as const;

export function signAccessToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  });
}

export function signRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
  // Without a unique jti, two logins by one user in the same second sign identical
  // tokens and the second hits the sessions.refresh_token unique index.
  return jwt.sign({ ...payload, type: 'refresh' }, config.JWT_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
    jwtid: randomUUID(),
  });
}

/**
 * The session row and the refresh cookie take their lifetime from this, so
 * JWT_REFRESH_EXPIRES_IN is parsed only by jsonwebtoken.
 */
export function tokenExpiresAt(token: string): Date {
  const decoded = jwt.decode(token);
  if (decoded === null || typeof decoded === 'string' || decoded.exp === undefined) {
    throw new Error('Token has no exp claim');
  }
  return new Date(decoded.exp * 1000);
}

const accessTokenClaimsSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  type: z.literal('access'),
});

export type AccessTokenPayload = z.infer<typeof accessTokenClaimsSchema>;

/**
 * A token with no session id is refused: the server never issues one, and
 * without a session there is nothing to revoke (GHSA-r434-hwqg-cvcw).
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  const claims = accessTokenClaimsSchema.safeParse(decoded);
  if (!claims.success) {
    throw new Error('Invalid access token claims');
  }
  return claims.data;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as JwtPayload;
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type: expected refresh token');
  }
  return decoded;
}
