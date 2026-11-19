import type { Response, CookieOptions } from 'express';
import { config } from '../config/index.js';
import { tokenExpiresAt } from './jwt.js';

const REFRESH_TOKEN_COOKIE = 'refreshToken';

function getCookieOptions(refreshToken: string): CookieOptions {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: Math.max(0, tokenExpiresAt(refreshToken).getTime() - Date.now()),
  };
}

export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, getCookieOptions(refreshToken));
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
  });
}

export function getRefreshTokenFromCookie(cookies: Record<string, string | undefined>): string | undefined {
  return cookies[REFRESH_TOKEN_COOKIE];
}
