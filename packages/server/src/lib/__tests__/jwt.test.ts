// ===========================================
// JWT Utility Tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: {
    JWT_SECRET: 'unit-test-secret-that-is-at-least-32-characters',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  },
}));

const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, tokenExpiresAt } = await import('../jwt.js');
const jwt = (await import('jsonwebtoken')).default;

describe('tokenExpiresAt', () => {
  it('returns the exp claim of a refresh token, set by JWT_REFRESH_EXPIRES_IN', () => {
    const expiresAt = tokenExpiresAt(signRefreshToken({ userId: 'u1' }));
    expect(Math.abs(expiresAt.getTime() - (Date.now() + 7 * 24 * 60 * 60 * 1000))).toBeLessThan(5_000);
  });

  it('throws for a token without an exp claim', () => {
    const noExp = jwt.sign({ userId: 'u1' }, 'unit-test-secret-that-is-at-least-32-characters');
    expect(() => tokenExpiresAt(noExp)).toThrow('Token has no exp claim');
  });

  it('throws for a value that is not a JWT', () => {
    expect(() => tokenExpiresAt('not-a-token')).toThrow('Token has no exp claim');
  });
});

describe('signRefreshToken', () => {
  it('issues a different token for each login, even in the same second', () => {
    const a = signRefreshToken({ userId: 'u1' });
    const b = signRefreshToken({ userId: 'u1' });
    expect(a).not.toBe(b);
  });

  it('still verifies as a refresh token for the same user', () => {
    const payload = verifyRefreshToken(signRefreshToken({ userId: 'u1' }));
    expect(payload.userId).toBe('u1');
    expect(payload.type).toBe('refresh');
  });
});

describe('verifyAccessToken', () => {
  const SECRET = 'unit-test-secret-that-is-at-least-32-characters';
  const sign = (payload: object): string => jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '15m' });

  it('returns the payload of an access token the server signed', () => {
    const payload = verifyAccessToken(signAccessToken({ userId: 'u1', sessionId: 's1' }));
    expect(payload).toMatchObject({ userId: 'u1', sessionId: 's1', type: 'access' });
  });

  it('refuses an access token with no session id (GHSA-r434-hwqg-cvcw)', () => {
    expect(() => verifyAccessToken(sign({ userId: 'u1', type: 'access' }))).toThrow();
  });

  it('refuses an access token whose session id is not a non-empty string', () => {
    expect(() => verifyAccessToken(sign({ userId: 'u1', sessionId: '', type: 'access' }))).toThrow();
    expect(() => verifyAccessToken(sign({ userId: 'u1', sessionId: 7, type: 'access' }))).toThrow();
  });

  it('refuses a refresh token used as an access token', () => {
    expect(() => verifyAccessToken(signRefreshToken({ userId: 'u1' }))).toThrow();
  });
});
