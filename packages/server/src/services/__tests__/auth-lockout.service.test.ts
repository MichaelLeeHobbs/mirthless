// ===========================================
// Auth Service: lockout outcomes and rotated session metadata (#174)
// ===========================================
// A wrong password is counted by one UPDATE ... RETURNING; login answers from
// the row it returns. The SQL itself (expired lock restarts the count,
// concurrent guesses all count, a late write never clears a lock) is proven
// against real Postgres in test/integration/auth-concurrency.itest.ts. A
// rotated session keeps the client details of the request that rotated it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResponses: unknown[][] = [];
let countedRow: unknown[] = [];
const mockSelect = vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(selectResponses.shift() ?? []) }) }));
const mockUpdate = vi.fn(() => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(countedRow) }) }) }));
const consumedSession = [{ userId: 'u-1', expiresAt: new Date(Date.now() + 60_000) }];
const mockDelete = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve(consumedSession) }) }));
const insertValues: Record<string, unknown>[] = [];
const mockInsert = vi.fn(() => ({
  values: (values: Record<string, unknown>) => { insertValues.push(values); return { returning: () => Promise.resolve([{ id: 'new-session' }]) }; },
}));
const mockDb = { select: mockSelect, update: mockUpdate, delete: mockDelete, insert: mockInsert };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn(), emitAuditEvent: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn().mockResolvedValue(false) } }));
vi.mock('../../lib/jwt.js', () => ({
  verifyRefreshToken: vi.fn(() => ({ userId: 'u-1' })),
  signRefreshToken: vi.fn(() => 'signed-refresh'),
  signAccessToken: vi.fn(() => 'signed-access'),
  tokenExpiresAt: vi.fn(() => new Date(Date.now() + 60_000)),
}));

const { AuthService } = await import('../auth.service.js');
const { errorResponse } = await import('../../lib/controller-helpers.js');

function user(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'u-1', username: 'alice', email: 'alice@example.test', role: 'viewer', enabled: true,
    lockedUntil: null, failedLoginAttempts: 0, passwordHash: 'h', mustChangePassword: false, ...overrides,
  };
}

async function loginCode(password: string): Promise<string | undefined> {
  const result = await AuthService.login('alice', password);
  return result.ok ? undefined : errorResponse(result.error).code;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResponses = [];
  countedRow = [];
  insertValues.length = 0;
});

describe('AuthService.login wrong password', () => {
  it('answers INVALID_CREDENTIALS while the count stays under the limit', async () => {
    selectResponses = [[user({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) })]];
    countedRow = [{ failedLoginAttempts: 1 }]; // the expired lock's count restarted

    expect(await loginCode('wrong')).toBe('INVALID_CREDENTIALS');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('answers ACCOUNT_LOCKED when this attempt reaches the limit', async () => {
    selectResponses = [[user({ failedLoginAttempts: 4 })]];
    countedRow = [{ failedLoginAttempts: 5 }];

    expect(await loginCode('wrong')).toBe('ACCOUNT_LOCKED');
  });

  it('answers ACCOUNT_LOCKED when a concurrent attempt locked the account first', async () => {
    selectResponses = [[user({ failedLoginAttempts: 4 })]];
    countedRow = [];

    expect(await loginCode('wrong')).toBe('ACCOUNT_LOCKED');
  });

  it('refuses a login while the lock is still running, without counting it', async () => {
    selectResponses = [[user({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) })]];

    expect(await loginCode('wrong')).toBe('ACCOUNT_LOCKED');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('AuthService.refreshSession client details', () => {
  it('stores the user agent and address of the refreshing request on the new session', async () => {
    selectResponses = [[user()]];

    const result = await AuthService.refreshSession('token', { userAgent: 'Firefox/140', ipAddress: '10.0.0.7' });

    expect(result.ok).toBe(true);
    expect(insertValues).toEqual([expect.objectContaining({ userAgent: 'Firefox/140', ipAddress: '10.0.0.7' })]);
  });
});
