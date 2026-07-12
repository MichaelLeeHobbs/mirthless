// ===========================================
// Message Reprocess Controller Tests — bulk reprocess + resend
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = {
  bulkReprocess: vi.fn(),
  resendDestination: vi.fn(),
};

vi.mock('../../services/message-reprocess.service.js', () => ({
  MessageReprocessService: mockService,
}));

vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { MessageReprocessController } = await import('../message-reprocess.controller.js');

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {}, query: {}, body: {}, ip: '10.0.0.9', user: { id: 'user-9' },
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageReprocessController.bulkReprocess', () => {
  it('returns the aggregate result on success', async () => {
    const value = { requested: 2, reprocessed: 2, results: [{ messageId: 1, newMessageId: 10 }, { messageId: 2, newMessageId: 11 }] };
    mockService.bulkReprocess.mockResolvedValue({ ok: true, value, error: null });
    const res = makeRes();

    await MessageReprocessController.bulkReprocess(
      makeReq({ params: { id: 'ch-1' } as never, body: { messageIds: [1, 2] } }),
      res,
    );

    expect(mockService.bulkReprocess).toHaveBeenCalledWith('ch-1', [1, 2], { userId: 'user-9', ipAddress: '10.0.0.9' });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: value });
  });

  it('maps a CONFLICT service error to HTTP 409', async () => {
    mockService.bulkReprocess.mockResolvedValue({ ok: false, value: null, error: { name: 'ServiceError', code: 'CONFLICT', message: 'not started' } });
    const res = makeRes();

    await MessageReprocessController.bulkReprocess(
      makeReq({ params: { id: 'ch-1' } as never, body: { messageIds: [1] } }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'CONFLICT', message: 'not started' } });
  });
});

describe('MessageReprocessController.resend', () => {
  it('returns the QUEUED result on success', async () => {
    const value = { messageId: 5, metaDataId: 1, status: 'QUEUED' };
    mockService.resendDestination.mockResolvedValue({ ok: true, value, error: null });
    const res = makeRes();

    await MessageReprocessController.resend(
      makeReq({ params: { id: 'ch-1', msgId: '5', metaDataId: '1' } as never }),
      res,
    );

    expect(mockService.resendDestination).toHaveBeenCalledWith('ch-1', 5, 1, { userId: 'user-9', ipAddress: '10.0.0.9' });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: value });
  });

  it('maps a NOT_FOUND service error to HTTP 404', async () => {
    mockService.resendDestination.mockResolvedValue({ ok: false, value: null, error: { name: 'ServiceError', code: 'NOT_FOUND', message: 'no dest' } });
    const res = makeRes();

    await MessageReprocessController.resend(
      makeReq({ params: { id: 'ch-1', msgId: '5', metaDataId: '9' } as never }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
