// ===========================================
// Auth Service — refreshSession re-validation (finding 10)
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResponses: unknown[] = [];
let selectIndex = 0;

const mockSelectWhere = vi.fn(() => {
  const v = selectResponses[selectIndex];
  selectIndex++;
  return Promise.resolve(v ?? []);
});
const mockSelect = vi.fn(() => ({ from: () => ({ where: mockSelectWhere }) }));

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'new-session' }]);
const mockInsert = vi.fn(() => ({ values: () => ({ returning: mockInsertReturning }) }));

const mockDb = { select: mockSelect, delete: mockDelete, insert: mockInsert };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));

vi.mock('../../lib/jwt.js', () => ({
  verifyRefreshToken: vi.fn(() => ({ userId: 'user-1' })),
  signRefreshToken: vi.fn(() => 'signed-refresh'),
  signAccessToken: vi.fn(() => 'signed-access'),
}));

vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_c: unknown, v: unknown) => ({ type: 'eq', v })),
}));

const { AuthService } = await import('../auth.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  selectResponses = [];
  selectIndex = 0;
  mockInsertReturning.mockResolvedValue([{ id: 'new-session' }]);
});

const future = new Date(Date.now() + 60_000);

describe('AuthService.refreshSession', () => {
  it('rotates tokens when the session and user are valid + enabled', async () => {
    selectResponses = [
      [{ id: 'sess-1', userId: 'user-1', expiresAt: future }], // session lookup
      [{ id: 'user-1', enabled: true }],                        // user re-validation
    ];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(true);
    expect(mockDeleteWhere).toHaveBeenCalled(); // old session rotated out
    expect(mockInsert).toHaveBeenCalled();       // new session created
  });

  it('rejects and drops the session when the user is disabled', async () => {
    selectResponses = [
      [{ id: 'sess-1', userId: 'user-1', expiresAt: future }],
      [{ id: 'user-1', enabled: false }],
    ];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
    expect(mockDeleteWhere).toHaveBeenCalled(); // disabled user's session removed
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    selectResponses = [
      [{ id: 'sess-1', userId: 'user-1', expiresAt: future }],
      [], // user gone
    ];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects when no matching session exists', async () => {
    selectResponses = [[]];

    const result = await AuthService.refreshSession('some-token');

    expect(result.ok).toBe(false);
  });
});
