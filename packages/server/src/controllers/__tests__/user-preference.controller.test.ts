// ===========================================
// User Preference Controller Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = {
  list: vi.fn(),
  getByKey: vi.fn(),
  upsert: vi.fn(),
  bulkUpsert: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../services/user-preference.service.js', () => ({ UserPreferenceService: mockService }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { UserPreferenceController } = await import('../user-preference.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(withUser: boolean): Request {
  return {
    params: { key: 'theme' },
    body: { key: 'theme', value: 'dark', entries: [{ key: 'theme', value: 'dark' }] },
    ...(withUser ? { user: { id: 'u1' } } : {}),
  } as unknown as Request;
}

const HANDLERS = ['list', 'getByKey', 'upsert', 'bulkUpsert', 'delete'] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserPreferenceController without an authenticated user', () => {
  // Behind authenticate this is a server bug. A 401 would make the web client
  // sign the user out as if the session had expired (D-263).
  it.each(HANDLERS)('%s answers 500 INTERNAL, not 401, and never calls the service', async (handler) => {
    const res = makeRes();

    await UserPreferenceController[handler](makeReq(false), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
    expect(mockService[handler]).not.toHaveBeenCalled();
  });
});

describe('UserPreferenceController with a user', () => {
  it('passes the user id to the service', async () => {
    mockService.list.mockResolvedValue({ ok: true, value: [], error: null });
    const res = makeRes();

    await UserPreferenceController.list(makeReq(true), res);

    expect(mockService.list).toHaveBeenCalledWith('u1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('list answers a NOT_FOUND service error with 404', async () => {
    mockService.list.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'User not found') });
    const res = makeRes();

    await UserPreferenceController.list(makeReq(true), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
  });

  it('list answers an unknown error with 500 and a generic body', async () => {
    mockService.list.mockResolvedValue({ ok: false, value: null, error: new Error('connection refused') });
    const res = makeRes();

    await UserPreferenceController.list(makeReq(true), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});
