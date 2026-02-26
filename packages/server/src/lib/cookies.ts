// ===========================================
// Cookie Utilities
// ===========================================
// Helpers for httpOnly refresh token cookies.

import type { Response, CookieOptions } from 'express';
import { config } from '../config/index.js';

const REFRESH_TOKEN_COOKIE = 'refreshToken';
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function getCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: REFRESH_TOKEN_MAX_AGE,
  };
}

export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, getCookieOptions());
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
