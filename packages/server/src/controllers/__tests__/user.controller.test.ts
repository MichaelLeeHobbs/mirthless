// ===========================================
// User Controller Tests (password changes)
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = { changePassword: vi.fn(), changeOwnPassword: vi.fn() };

vi.mock('../../services/user.service.js', () => ({ UserService: mockService }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { UserController } = await import('../user.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(body: Record<string, unknown>): Request {
  return {
    params: { id: 'u2' },
    query: {},
    body,
    ip: '10.0.0.1',
    sessionId: 's1',
    user: { id: 'u1', role: 'developer' },
  } as unknown as Request;
}

describe('UserController password changes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('answers a wrong current password with 400, not 401, so the client does not treat it as an expired session', async () => {
    mockService.changeOwnPassword.mockResolvedValue({ ok: false, value: null, error: new ServiceError('INVALID_CREDENTIALS', 'Current password is incorrect') });
    const res = makeRes();

    await UserController.changeOwnPassword(makeReq({ currentPassword: 'wrong', newPassword: 'N3w-password!' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' } });
  });

  it('answers a change to another user\'s password without rights with 403', async () => {
    mockService.changePassword.mockResolvedValue({ ok: false, value: null, error: new ServiceError('FORBIDDEN', 'Cannot change another user\'s password') });
    const res = makeRes();

    await UserController.changePassword(makeReq({ newPassword: 'N3w-password!' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 204 when the password is changed', async () => {
    mockService.changeOwnPassword.mockResolvedValue({ ok: true, value: undefined, error: null });
    const res = makeRes();
    await UserController.changeOwnPassword(makeReq({ currentPassword: 'old', newPassword: 'N3w-password!' }), res);
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
