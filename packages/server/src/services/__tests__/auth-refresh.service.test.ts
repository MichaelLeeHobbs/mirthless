// The single-use guarantee under concurrency is proven against real Postgres
// in test/integration/auth-concurrency.itest.ts.

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

vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn(), emitAuditEvent: vi.fn() }));

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
    expect(mockDeleteReturning).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('rejects when the user is disabled, after consuming the session', async () => {
    consumed = [{ userId: 'user-1', expiresAt: future }];
    userRows = [{ id: 'user-1', enabled: false }];

    const result = await AuthService.refreshSession('some-token');

    // UNAUTHORIZED is what clears the cookie; any other failure keeps the person signed in (#473).
    expect(result).toMatchObject({ ok: false, error: { name: 'ServiceError', code: 'UNAUTHORIZED' } });
    expect(mockDeleteReturning).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    consumed = [{ userId: 'user-1', expiresAt: future }];

    const result = await AuthService.refreshSession('some-token');

    // UNAUTHORIZED is what clears the cookie; any other failure keeps the person signed in (#473).
    expect(result).toMatchObject({ ok: false, error: { name: 'ServiceError', code: 'UNAUTHORIZED' } });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects when no session was consumed (unknown or already used token)', async () => {
    const result = await AuthService.refreshSession('some-token');

    // UNAUTHORIZED is what clears the cookie; any other failure keeps the person signed in (#473).
    expect(result).toMatchObject({ ok: false, error: { name: 'ServiceError', code: 'UNAUTHORIZED' } });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a token that does not verify, before consuming anything', async () => {
    const { verifyRefreshToken } = await import('../../lib/jwt.js');
    vi.mocked(verifyRefreshToken).mockImplementationOnce(() => { throw new Error('invalid signature'); });

    const result = await AuthService.refreshSession('some-token');

    expect(result).toMatchObject({ ok: false, error: { name: 'ServiceError', code: 'UNAUTHORIZED' } });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('fails with the read\'s own error, not UNAUTHORIZED, when the session cannot be read', async () => {
    mockDeleteReturning.mockRejectedValueOnce(new Error('Connection terminated due to connection timeout'));

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.message).toBe('Connection terminated due to connection timeout');
  });

  it('rejects an expired session', async () => {
    consumed = [{ userId: 'user-1', expiresAt: new Date(Date.now() - 1000) }];

    const result = await AuthService.refreshSession('some-token');

    // UNAUTHORIZED is what clears the cookie; any other failure keeps the person signed in (#473).
    expect(result).toMatchObject({ ok: false, error: { name: 'ServiceError', code: 'UNAUTHORIZED' } });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
