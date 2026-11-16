// ===========================================
// Auth Service: lockout window and rotated session metadata (#174)
// ===========================================
// A lock that has expired starts a new count of failed attempts, so one wrong
// password after the lock does not lock the account again. A rotated session
// keeps the client details of the request that rotated it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResponses: unknown[][] = [];
const mockSelect = vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(selectResponses.shift() ?? []) }) }));
const updateSets: Record<string, unknown>[] = [];
const mockUpdate = vi.fn(() => ({
  set: (values: Record<string, unknown>) => { updateSets.push(values); return { where: () => Promise.resolve(undefined) }; },
}));
const mockDelete = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
const insertValues: Record<string, unknown>[] = [];
const mockInsert = vi.fn(() => ({
  values: (values: Record<string, unknown>) => { insertValues.push(values); return { returning: () => Promise.resolve([{ id: 'new-session' }]) }; },
}));
const mockDb = { select: mockSelect, update: mockUpdate, delete: mockDelete, insert: mockInsert };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn().mockResolvedValue(false) } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('../../lib/jwt.js', () => ({
  verifyRefreshToken: vi.fn(() => ({ userId: 'u-1' })),
  signRefreshToken: vi.fn(() => 'signed-refresh'),
  signAccessToken: vi.fn(() => 'signed-access'),
  tokenExpiresAt: vi.fn(() => new Date(Date.now() + 60_000)),
}));

const { AuthService } = await import('../auth.service.js');

function user(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'u-1', username: 'alice', email: 'alice@example.test', role: 'viewer', enabled: true,
    lockedUntil: null, failedLoginAttempts: 0, passwordHash: 'h', mustChangePassword: false, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResponses = [];
  updateSets.length = 0;
  insertValues.length = 0;
});

describe('AuthService.login lockout window', () => {
  it('starts a new count after a lock expires, so one wrong password does not lock again', async () => {
    selectResponses = [[user({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) })]];

    const result = await AuthService.login('alice', 'wrong');

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { code?: string }).code).toBe('INVALID_CREDENTIALS');
    expect(updateSets).toEqual([expect.objectContaining({ failedLoginAttempts: 1, lockedUntil: null })]);
  });

  it('still locks on the fifth wrong password inside one window', async () => {
    selectResponses = [[user({ failedLoginAttempts: 4 })]];

    const result = await AuthService.login('alice', 'wrong');

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { code?: string }).code).toBe('ACCOUNT_LOCKED');
    expect(updateSets[0]?.['failedLoginAttempts']).toBe(5);
    expect(updateSets[0]?.['lockedUntil']).toBeInstanceOf(Date);
  });

  it('refuses a login while the lock is still running, without counting it', async () => {
    selectResponses = [[user({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) })]];

    const result = await AuthService.login('alice', 'wrong');

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { code?: string }).code).toBe('ACCOUNT_LOCKED');
    expect(updateSets).toEqual([]);
  });
});

describe('AuthService.refreshSession client details', () => {
  it('stores the user agent and address of the refreshing request on the new session', async () => {
    selectResponses = [
      [{ id: 'sess-1', userId: 'u-1', expiresAt: new Date(Date.now() + 60_000) }],
      [user()],
    ];

    const result = await AuthService.refreshSession('token', { userAgent: 'Firefox/140', ipAddress: '10.0.0.7' });

    expect(result.ok).toBe(true);
    expect(insertValues).toEqual([expect.objectContaining({ userAgent: 'Firefox/140', ipAddress: '10.0.0.7' })]);
  });
});
