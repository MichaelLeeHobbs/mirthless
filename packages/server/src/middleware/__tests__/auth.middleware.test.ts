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

vi.mock('../../lib/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// db.select().from().where() — first call returns the user row, second returns
// the permission rows.
let userRow: Record<string, unknown> | undefined;
const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../../lib/db.js', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}));
vi.mock('../../db/schema/index.js', () => ({
  users: {}, userPermissions: {},
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

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
  mockVerify.mockReturnValue({ userId: 'u1' });
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
