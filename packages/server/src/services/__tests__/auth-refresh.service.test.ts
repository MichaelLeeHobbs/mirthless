// ===========================================
// Auth Service — refreshSession re-validation (finding 10)
// ===========================================
// The refresh consumes its session with one DELETE ... RETURNING, then checks
// the user. The single-use guarantee under concurrency is proven against real
// Postgres in test/integration/auth-concurrency.itest.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let consumed: unknown[] = [];
let userRows: unknown[] = [];

const mockSelectWhere = vi.fn(() => Promise.resolve(userRows));
const mockSelect = vi.fn(() => ({ from: () => ({ where: mockSelectWhere }) }));

const mockDeleteReturning = vi.fn(() => Promise.resolve(consumed));
const mockDelete = vi.fn(() => ({ where: () => ({ returning: mockDeleteReturning }) }));

const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'new-session' }]);
const mockInsert = vi.fn(() => ({ values: () => ({ returning: mockInsertReturning }) }));

const mockDb = { select: mockSelect, delete: mockDelete, insert: mockInsert };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));

vi.mock('../../lib/jwt.js', () => ({
  verifyRefreshToken: vi.fn(() => ({ userId: 'user-1' })),
  signRefreshToken: vi.fn(() => 'signed-refresh'),
  signAccessToken: vi.fn(() => 'signed-access'),
  tokenExpiresAt: vi.fn(() => new Date(Date.now() + 60_000)),
}));

vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

const { AuthService } = await import('../auth.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  consumed = [];
  userRows = [];
  mockInsertReturning.mockResolvedValue([{ id: 'new-session' }]);
});

const future = new Date(Date.now() + 60_000);

describe('AuthService.refreshSession', () => {
  it('rotates tokens when the session and user are valid + enabled', async () => {
    consumed = [{ userId: 'user-1', expiresAt: future }];
    userRows = [{ id: 'user-1', enabled: true }];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(true);
    expect(mockDeleteReturning).toHaveBeenCalled(); // old session consumed
    expect(mockInsert).toHaveBeenCalled();          // new session created
  });

  it('rejects when the user is disabled, after consuming the session', async () => {
    consumed = [{ userId: 'user-1', expiresAt: future }];
    userRows = [{ id: 'user-1', enabled: false }];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
    expect(mockDeleteReturning).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    consumed = [{ userId: 'user-1', expiresAt: future }];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects when no session was consumed (unknown or already used token)', async () => {
    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    consumed = [{ userId: 'user-1', expiresAt: new Date(Date.now() - 1000) }];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
