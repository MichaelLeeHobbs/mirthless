// Every rejected login and every logout must reach the audit log.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResult: unknown[] = [];
const mockSelect = vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(selectResult) }) }));
/** The row the failed-attempt UPDATE ... RETURNING gives back. */
let countedRow: unknown[] = [];
const mockUpdate = vi.fn(() => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(countedRow) }) }) }));
const mockDelete = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
const mockDb = { select: mockSelect, update: mockUpdate, delete: mockDelete };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('../../lib/event-emitter.js', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('bcrypt', () => ({ default: { compare: vi.fn().mockResolvedValue(false) } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), or: vi.fn(), isNull: vi.fn(), lte: vi.fn(), sql: vi.fn() }));

const { AuthService } = await import('../auth.service.js');
const { emitAuditEvent: emitEvent } = await import('../../lib/event-emitter.js');

const META = { ipAddress: '10.0.0.9' };

function user(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'u-1', username: 'alice', enabled: true, lockedUntil: null, failedLoginAttempts: 0, passwordHash: 'h', ...overrides };
}

function expectFailureAudit(userId: string | null, reason: string): void {
  expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
    action: 'USER_LOGIN_FAILED', outcome: 'FAILURE', userId, ipAddress: '10.0.0.9',
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

  it('records at most 100 characters of the typed username, the longest a username can be', async () => {
    selectResult = [];
    await AuthService.login('x'.repeat(5000), 'pw', META);
    const attrs = vi.mocked(emitEvent).mock.calls[0]?.[0]?.attributes as { username: string } | undefined;
    expect(attrs?.username).toHaveLength(100);
  });

  it('does a password comparison for an unknown username, so timing does not reveal which accounts exist', async () => {
    selectResult = [];
    const bcrypt = (await import('bcrypt')).default;
    await AuthService.login('alice', 'pw', META);
    expect(bcrypt.compare).toHaveBeenCalledWith('pw', expect.stringMatching(/^\$2b\$12\$/));
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
    countedRow = [{ failedLoginAttempts: 1 }];
    await AuthService.login('alice', 'pw', META);
    expectFailureAudit('u-1', 'invalid_password');
  });

  it('records the wrong password that locks the account', async () => {
    selectResult = [user({ failedLoginAttempts: 4 })];
    countedRow = [{ failedLoginAttempts: 5 }];
    const result = await AuthService.login('alice', 'pw', META);
    expect(result.ok).toBe(false);
    expectFailureAudit('u-1', 'invalid_password_locked');
  });

  it('records a wrong password that arrives after a concurrent one locked the account', async () => {
    selectResult = [user({ failedLoginAttempts: 4 })];
    countedRow = []; // the UPDATE matched nothing: the account is locked now
    await AuthService.login('alice', 'pw', META);
    expectFailureAudit('u-1', 'account_locked');
  });
});

describe('AuthService.logout audit', () => {
  it('deletes the session and records the logout', async () => {
    const result = await AuthService.logout('sess-1', 'u-1', '10.0.0.9');
    expect(result.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_LOGOUT', outcome: 'SUCCESS', userId: 'u-1', ipAddress: '10.0.0.9',
    }));
  });
});
