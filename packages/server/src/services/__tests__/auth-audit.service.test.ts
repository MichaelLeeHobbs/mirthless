// ===========================================
// Auth Service — audit trail for rejected logins and logout
// ===========================================
// Every rejected login (unknown user, locked, disabled, wrong password) and
// every logout must reach the audit log.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResult: unknown[] = [];
const mockSelect = vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(selectResult) }) }));
const mockUpdate = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }));
const mockDelete = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
const mockDb = { select: mockSelect, update: mockUpdate, delete: mockDelete };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn().mockResolvedValue(false) } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

const { AuthService } = await import('../auth.service.js');
const { emitEvent } = await import('../../lib/event-emitter.js');

const META = { ipAddress: '10.0.0.9' };

function user(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'u-1', username: 'alice', enabled: true, lockedUntil: null, failedLoginAttempts: 0, passwordHash: 'h', ...overrides };
}

function expectFailureAudit(userId: string | null, reason: string): void {
  expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
    name: 'USER_LOGIN_FAILED', outcome: 'FAILURE', userId, ipAddress: '10.0.0.9',
    attributes: { username: 'alice', reason },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthService.login audit', () => {
  it('records a login attempt for an unknown username', async () => {
    selectResult = [];
    const result = await AuthService.login('alice', 'pw', META);
    expect(result.ok).toBe(false);
    expectFailureAudit(null, 'unknown_user');
  });

  it('records a login attempt against a locked account', async () => {
    selectResult = [user({ lockedUntil: new Date(Date.now() + 60_000) })];
    await AuthService.login('alice', 'pw', META);
    expectFailureAudit('u-1', 'account_locked');
  });

  it('records a login attempt against a disabled account', async () => {
    selectResult = [user({ enabled: false })];
    await AuthService.login('alice', 'pw', META);
    expectFailureAudit('u-1', 'account_disabled');
  });

  it('records a wrong password', async () => {
    selectResult = [user()];
    await AuthService.login('alice', 'pw', META);
    expectFailureAudit('u-1', 'invalid_password');
  });

  it('records the wrong password that locks the account', async () => {
    selectResult = [user({ failedLoginAttempts: 4 })];
    const result = await AuthService.login('alice', 'pw', META);
    expect(result.ok).toBe(false);
    expectFailureAudit('u-1', 'invalid_password_locked');
  });
});

describe('AuthService.logout audit', () => {
  it('deletes the session and records the logout', async () => {
    const result = await AuthService.logout('sess-1', 'u-1', '10.0.0.9');
    expect(result.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'USER_LOGOUT', outcome: 'SUCCESS', userId: 'u-1', ipAddress: '10.0.0.9',
    }));
  });
});
