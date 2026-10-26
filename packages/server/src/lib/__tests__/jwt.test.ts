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

const { signRefreshToken, verifyRefreshToken } = await import('../jwt.js');

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
