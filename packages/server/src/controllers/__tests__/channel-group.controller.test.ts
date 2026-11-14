// ===========================================
// Channel Group Controller Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = { delete: vi.fn() };

vi.mock('../../services/channel-group.service.js', () => ({ ChannelGroupService: mockService }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { ChannelGroupController } = await import('../channel-group.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(): Request {
  return { params: { id: 'g1' }, query: {}, body: {}, ip: '10.0.0.1', user: { id: 'u1' } } as unknown as Request;
}

describe('ChannelGroupController.delete', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 204 when the group is deleted', async () => {
    mockService.delete.mockResolvedValue({ ok: true, value: undefined, error: null });
    const res = makeRes();
    await ChannelGroupController.delete(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 403 with the reason when the default group is protected', async () => {
    const error = new ServiceError('FORBIDDEN', 'The "Default" channel group cannot be deleted');
    mockService.delete.mockResolvedValue({ ok: false, value: null, error });
    const res = makeRes();

    await ChannelGroupController.delete(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: error.message } });
  });

  it('returns 404 for a missing group', async () => {
    mockService.delete.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Channel group not found') });
    const res = makeRes();
    await ChannelGroupController.delete(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
