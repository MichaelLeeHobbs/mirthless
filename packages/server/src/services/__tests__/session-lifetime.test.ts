// JWT_REFRESH_EXPIRES_IN sets the refresh JWT's exp, the session row's expiry
// and the refresh cookie's max age (#99).

import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Response, CookieOptions } from 'express';

vi.mock('../../config/index.js', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_SECRET: 'unit-test-secret-that-is-at-least-32-characters',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '30d',
  },
}));

const insertedSessions: Record<string, unknown>[] = [];
const sessionRow = { id: 'sess-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) };
const selectResponses: unknown[][] = [];
const mockDb = {
  select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(selectResponses.shift() ?? []) }) })),
  delete: vi.fn(() => ({ where: () => ({ returning: vi.fn().mockResolvedValue([sessionRow]) }) })),
  insert: vi.fn(() => ({
    values: (values: Record<string, unknown>) => {
      insertedSessions.push(values);
      return { returning: vi.fn().mockResolvedValue([{ id: 'sess-2' }]) };
    },
  })),
};
vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn(), emitAuditEvent: vi.fn() }));
vi.mock('../../lib/principal.js', async () => {
  const { standingFor } = await import('../../../test/standing.js');
  return {
    loadUserStanding: vi.fn(() => Promise.resolve(standingFor({ id: 'user-1', role: 'viewer' }))),
    roleLabel: (names: readonly string[]) => names.join(', '),
  };
});

const { AuthService } = await import('../auth.service.js');
const { signRefreshToken } = await import('../../lib/jwt.js');
const { setRefreshTokenCookie } = await import('../../lib/cookies.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function expectAbout(actualMs: number, expectedMs: number): void {
  // Seconds of slack: exp is whole seconds and the test takes some time.
  expect(Math.abs(actualMs - expectedMs)).toBeLessThan(5_000);
}

describe('session lifetime from JWT_REFRESH_EXPIRES_IN', () => {
  it('uses the configured 30 days for the JWT exp, the session row and the cookie', async () => {
    const result = await AuthService.refreshSession(signRefreshToken({ userId: 'user-1' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const now = Date.now();
    const decoded = jwt.decode(result.value.refreshToken) as { exp: number };
    expectAbout(decoded.exp * 1000 - now, 30 * DAY_MS);

    const expiresAt = insertedSessions[0]?.['expiresAt'] as Date;
    expectAbout(expiresAt.getTime() - now, 30 * DAY_MS);

    let cookieOptions: CookieOptions | undefined;
    const res = { cookie: (_name: string, _value: string, options: CookieOptions) => { cookieOptions = options; } };
    setRefreshTokenCookie(res as unknown as Response, result.value.refreshToken);
    expectAbout(cookieOptions?.maxAge ?? 0, 30 * DAY_MS);
  });
});
