// ===========================================
// JWT Utilities
// ===========================================

import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface JwtPayload {
  userId: string;
  sessionId?: string;
  type: 'access' | 'refresh';
}

// Pin the signing algorithm on both sign and verify. Without an explicit
// `algorithms` allowlist, jwt.verify accepts any algorithm in the token header,
// which enables algorithm-confusion attacks (e.g. a forged `alg: none` token or
// HS/RS confusion). We only ever use HS256.
const JWT_ALGORITHM = 'HS256' as const;

export function signAccessToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  });
}

export function signRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, config.JWT_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as JwtPayload;
  if (decoded.type !== 'access') {
    throw new Error('Invalid token type: expected access token');
  }
  return decoded;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as JwtPayload;
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type: expected refresh token');
  }
  return decoded;
}
