// ===========================================
// Auth Middleware Tests
// ===========================================
// Focused on token verification and the server-side forced-password-change gate.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ----- Mocks -----

const mockVerify = vi.fn();
vi.mock('../../lib/jwt.js', () => ({
  verifyAccessToken: (token: string) => mockVerify(token),
}));

const mockEmit = vi.fn();
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: (...args: unknown[]) => { mockEmit(...args); } }));

vi.mock('../../lib/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// db.select().from().where() — first call returns the user row, second returns
// the permission rows.
let userRow: Record<string, unknown> | undefined;
const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn((..._args: unknown[]) => ({ from: mockFrom }));
vi.mock('../../lib/db.js', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}));
vi.mock('../../db/schema/index.js', () => ({
  users: {}, userPermissions: {},
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
// Session liveness has its own tests (session-live.test.ts, forged-token.routes.test.ts).
vi.mock('../../lib/session-live.js', () => ({ isSessionLive: vi.fn(() => Promise.resolve(true)) }));

const { authenticate } = await import('../auth.middleware.js');

// ----- Helpers -----

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((payload: unknown) => { res.body = payload; return res; }) as unknown as Response['json'];
  return res;
}

function makeReq(method: string, originalUrl: string): Request {
  return {
    method, originalUrl,
    headers: { authorization: 'Bearer tok' },
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockReturnValue({ userId: 'u1', sessionId: 's1', type: 'access' });
  // First where() call -> user row; subsequent -> permission rows.
  mockWhere.mockImplementation(() => (userRow ? Promise.resolve([userRow]) : Promise.resolve([])));
});

describe('authenticate — forced password change gate', () => {
  it('blocks a normal request with 403 PASSWORD_CHANGE_REQUIRED when mustChangePassword is set', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'PASSWORD_CHANGE_REQUIRED', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the self password-change endpoint while mustChangePassword is set', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('POST', '/api/v1/users/me/password'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('allows logout while mustChangePassword is set', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('POST', '/api/v1/auth/logout'), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('passes a normal request through when mustChangePassword is false', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: false };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });
});

describe('authenticate — refusals are recorded through deny()', () => {
  const recorded = (): Record<string, unknown> => mockEmit.mock.calls.at(-1)?.[0] as Record<string, unknown>;

  it('records a refused password-change caller by user id', async () => {
    userRow = { id: 'u-pw', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };

    await authenticate(makeReq('GET', '/api/v1/channels'), makeRes(), vi.fn());

    expect(recorded()).toMatchObject({ name: 'ACCESS_DENIED', userId: 'u-pw', attributes: { reason: 'password_change_required', principal: 'user', route: null } });
  });

  it('records a disabled account by user id', async () => {
    userRow = { id: 'u-off', username: 'x', email: 'a@b.c', role: 'viewer', enabled: false, mustChangePassword: false };
    const res = makeRes();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, vi.fn());

    expect(res.body).toEqual({ success: false, error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is deactivated' } });
    expect(recorded()).toMatchObject({ userId: 'u-off', attributes: { reason: 'account_disabled' } });
  });

  it('records a token that does not verify as an anonymous bad token', async () => {
    mockVerify.mockImplementation(() => { throw new Error('jwt malformed'); });
    const res = makeRes();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, vi.fn());

    expect(res.statusCode).toBe(401);
    expect(recorded()).toMatchObject({ userId: null, attributes: { reason: 'bad_token', principal: 'anonymous' } });
  });
});
