// ===========================================
// Permission Middleware Tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requirePermission, requireAllPermissions } from '../permission.middleware.js';

vi.mock('../../lib/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  return res;
}

describe('requirePermission', () => {
  it('returns 401 with structured error when unauthenticated', () => {
    const res = makeRes();
    const next = vi.fn();
    requirePermission('channels:read')({} as Request, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 with structured error when permission missing', () => {
    const res = makeRes();
    const next = vi.fn();
    const req = { user: { id: 'u1', permissions: ['channels:read'], path: '/x' }, path: '/x' } as unknown as Request;
    requirePermission('users:write')(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the user holds one of the required permissions', () => {
    const res = makeRes();
    const next = vi.fn();
    const req = { user: { id: 'u1', permissions: ['channels:read'] }, path: '/x' } as unknown as Request;
    requirePermission('channels:read', 'channels:write')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe('requireAllPermissions', () => {
  it('returns 403 structured error when any permission is missing', () => {
    const res = makeRes();
    const next = vi.fn();
    const req = { user: { id: 'u1', permissions: ['channels:read'] }, path: '/x' } as unknown as Request;
    requireAllPermissions('channels:read', 'channels:write')(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  });

  it('calls next when all permissions are present', () => {
    const res = makeRes();
    const next = vi.fn();
    const req = { user: { id: 'u1', permissions: ['channels:read', 'channels:write'] }, path: '/x' } as unknown as Request;
    requireAllPermissions('channels:read', 'channels:write')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
