// ===========================================
// Permission Middleware Tests
// ===========================================

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Request, Response } from 'express';

const emitEvent = vi.fn();
vi.mock('../../lib/event-emitter.js', () => ({ emitAuditEvent: (...args: unknown[]) => { emitEvent(...args); } }));
vi.mock('../../lib/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { requirePermission, requireAllPermissions, deny, permissionsOfGuard, DENY_REASON } = await import('../permission.middleware.js');

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

interface ReqParts {
  readonly userId?: string;
  readonly permissions?: readonly string[];
  readonly route?: string;
  readonly method?: string;
}

function makeReq(parts: ReqParts = {}): Request {
  return {
    method: parts.method ?? 'GET',
    baseUrl: '/api/v1/channels',
    originalUrl: '/api/v1/channels/3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c/messages?q=Smith',
    route: parts.route === undefined ? undefined : { path: parts.route },
    id: 'req-1',
    ip: '10.0.0.7',
    ...(parts.userId === undefined ? {} : { user: { id: parts.userId, permissions: parts.permissions ?? [] } }),
  } as unknown as Request;
}

/** The attributes of the one event recorded so far. */
function recorded(): Record<string, unknown> {
  expect(emitEvent).toHaveBeenCalledOnce();
  return (emitEvent.mock.calls[0]?.[0] as { attributes: Record<string, unknown> }).attributes;
}

// One fake clock for the file. Each test starts ten minutes on, after the sweep
// has written and forgotten every window, so no test sees another's refusals.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 16, 9, 0, 0));
});
beforeEach(() => {
  vi.advanceTimersByTime(10 * 60_000);
  emitEvent.mockReset();
});
afterAll(() => { vi.useRealTimers(); });

describe('requirePermission', () => {
  it('returns 401 with structured error when unauthenticated', () => {
    const res = makeRes();
    const next = vi.fn();
    requirePermission('channels:read')(makeReq({ route: '/:id' }), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 with structured error when permission missing', () => {
    const res = makeRes();
    const next = vi.fn();
    requirePermission('users:write')(makeReq({ userId: 'u1', permissions: ['channels:read'], route: '/' }), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the user holds one of the required permissions', () => {
    const res = makeRes();
    const next = vi.fn();
    requirePermission('channels:read', 'channels:write')(makeReq({ userId: 'u1', permissions: ['channels:read'], route: '/' }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('says which permissions it checks, so the route walks can read them', () => {
    expect(permissionsOfGuard(requirePermission('messages:read', 'messages:delete'))).toEqual(['messages:read', 'messages:delete']);
    expect(permissionsOfGuard(requireAllPermissions('messages:read'))).toEqual(['messages:read']);
    expect(permissionsOfGuard(() => undefined)).toBeUndefined();
    expect(permissionsOfGuard('not a function')).toBeUndefined();
  });
});

describe('requireAllPermissions', () => {
  it('returns 403 structured error when any permission is missing', () => {
    const res = makeRes();
    const next = vi.fn();
    requireAllPermissions('channels:read', 'channels:write')(makeReq({ userId: 'u1', permissions: ['channels:read'], route: '/' }), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    expect(recorded()['reason']).toBe('no_permission');
  });

  it('returns 401 when unauthenticated', () => {
    const res = makeRes();
    requireAllPermissions('channels:read')(makeReq({ route: '/' }), res, vi.fn());

    expect(res.statusCode).toBe(401);
  });

  it('calls next when all permissions are present', () => {
    const res = makeRes();
    const next = vi.fn();
    requireAllPermissions('channels:read', 'channels:write')(makeReq({ userId: 'u1', permissions: ['channels:read', 'channels:write'], route: '/' }), res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe('deny', () => {
  it.each([
    [DENY_REASON.NO_CREDENTIALS, 401, 'UNAUTHORIZED', 'Unauthorized'],
    [DENY_REASON.BAD_TOKEN, 401, 'UNAUTHORIZED', 'Invalid or expired token'],
    [DENY_REASON.USER_NOT_FOUND, 401, 'UNAUTHORIZED', 'User not found'],
    [DENY_REASON.SESSION_REVOKED, 401, 'UNAUTHORIZED', 'Session expired or revoked'],
    [DENY_REASON.ACCOUNT_DISABLED, 403, 'ACCOUNT_DEACTIVATED', 'Account is deactivated'],
    [DENY_REASON.PASSWORD_CHANGE_REQUIRED, 403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing.'],
    [DENY_REASON.NO_PERMISSION, 403, 'FORBIDDEN', 'Forbidden'],
  ])('answers %s with %i %s', (reason, status, code, message) => {
    const res = makeRes();
    deny(makeReq(), res, reason);

    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ success: false, error: { code, message } });
  });

  it('records the refusal with the route template, never the URL or query', () => {
    deny(makeReq({ userId: 'u1', route: '/:id/messages' }), makeRes(), DENY_REASON.NO_PERMISSION);

    const event = emitEvent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(event).toMatchObject({ action: 'ACCESS_DENIED', outcome: 'FAILURE', userId: 'u1', ipAddress: '10.0.0.7' });
    expect(recorded()).toEqual({
      method: 'GET', route: '/api/v1/channels/:id/messages', reason: 'no_permission', status: 403,
      principal: 'user', requestId: 'req-1', repeatsSinceLast: 0,
    });
    expect(JSON.stringify(event)).not.toContain('Smith');
    expect(JSON.stringify(event)).not.toContain('3f1c2a4e');
  });

  it('records a refusal before routing with no route, and an unknown caller as anonymous', () => {
    deny(makeReq(), makeRes(), DENY_REASON.BAD_TOKEN);

    expect(recorded()).toMatchObject({ route: null, principal: 'anonymous', reason: 'bad_token', status: 401 });
    expect((emitEvent.mock.calls[0]?.[0] as { userId: unknown }).userId).toBeNull();
  });

  it('records the user authenticate identified before it set req.user', () => {
    deny(makeReq(), makeRes(), DENY_REASON.ACCOUNT_DISABLED, 'u9');

    expect(recorded()).toMatchObject({ principal: 'user', reason: 'account_disabled' });
    expect((emitEvent.mock.calls[0]?.[0] as { userId: unknown }).userId).toBe('u9');
  });

  it('records one refusal per caller, route and reason a minute, and writes the held-back count when the minute ends', () => {
    const req = makeReq({ userId: 'u1', route: '/:id' });
    deny(req, makeRes(), DENY_REASON.NO_PERMISSION);
    vi.advanceTimersByTime(30_000);
    deny(req, makeRes(), DENY_REASON.NO_PERMISSION);
    deny(req, makeRes(), DENY_REASON.NO_PERMISSION);
    expect(emitEvent).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(31_000);
    deny(req, makeRes(), DENY_REASON.NO_PERMISSION);

    const repeats = emitEvent.mock.calls.map((c) => (c[0] as { attributes: Record<string, unknown> }).attributes['repeatsSinceLast']);
    // The opening record, the two held back in its minute, then the next minute's opening record.
    expect(repeats).toEqual([0, 2, 0]);
  });

  it('writes the repeats of a window nobody refused again after, once the window has closed', () => {
    const req = makeReq({ userId: 'u-quiet', route: '/:id' });
    deny(req, makeRes(), DENY_REASON.NO_PERMISSION);
    deny(req, makeRes(), DENY_REASON.NO_PERMISSION);
    deny(req, makeRes(), DENY_REASON.NO_PERMISSION);

    vi.advanceTimersByTime(2 * 60_000);

    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(emitEvent.mock.calls[1]?.[0]).toMatchObject({
      action: 'ACCESS_DENIED', userId: 'u-quiet', ipAddress: '10.0.0.7',
      attributes: { route: '/api/v1/channels/:id', reason: 'no_permission', repeatsSinceLast: 2, requestId: null },
    });
  });

  it('writes nothing more for a window with no repeats', () => {
    deny(makeReq({ userId: 'u-once', route: '/' }), makeRes(), DENY_REASON.NO_PERMISSION);
    vi.advanceTimersByTime(3 * 60_000);

    expect(emitEvent).toHaveBeenCalledOnce();
  });

  it('records the mount path in lower case, so changing the URL case does not open a new window', () => {
    const shout = { ...makeReq({ userId: 'u-case', route: '/:id' }), baseUrl: '/api/v1/CHANNELS' } as unknown as Request;
    const mixed = { ...makeReq({ userId: 'u-case', route: '/:id' }), baseUrl: '/api/v1/Channels' } as unknown as Request;
    deny(shout, makeRes(), DENY_REASON.NO_PERMISSION);
    deny(mixed, makeRes(), DENY_REASON.NO_PERMISSION);

    expect(recorded()['route']).toBe('/api/v1/channels/:id');
  });

  it('records a different caller, route, method or reason separately within the minute', () => {
    deny(makeReq({ userId: 'u1', route: '/:id' }), makeRes(), DENY_REASON.NO_PERMISSION);
    deny(makeReq({ userId: 'u2', route: '/:id' }), makeRes(), DENY_REASON.NO_PERMISSION);
    deny(makeReq({ userId: 'u1', route: '/' }), makeRes(), DENY_REASON.NO_PERMISSION);
    deny(makeReq({ userId: 'u1', route: '/:id', method: 'DELETE' }), makeRes(), DENY_REASON.NO_PERMISSION);
    deny(makeReq({ userId: 'u1', route: '/:id' }), makeRes(), DENY_REASON.PASSWORD_CHANGE_REQUIRED);

    expect(emitEvent).toHaveBeenCalledTimes(5);
  });

  it('coalesces anonymous refusals into one record a minute per reason, whatever the URL', () => {
    for (let i = 0; i < 50; i += 1) deny(makeReq(), makeRes(), DENY_REASON.NO_CREDENTIALS);

    expect(emitEvent).toHaveBeenCalledOnce();
  });

  it('still answers the refusal when recording it throws', () => {
    emitEvent.mockImplementation(() => { throw new Error('event store down'); });
    const res = makeRes();
    deny(makeReq({ userId: 'u1', route: '/' }), res, DENY_REASON.NO_PERMISSION);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  });
});
