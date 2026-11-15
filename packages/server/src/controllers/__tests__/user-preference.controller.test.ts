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
  it.each(HANDLERS)('%s answers 401 and never calls the service', async (handler) => {
    const res = makeRes();

    await UserPreferenceController[handler](makeReq(false), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
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
});
