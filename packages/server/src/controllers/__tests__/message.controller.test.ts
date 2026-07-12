// ===========================================
// Message Controller Tests — PHI Audit (finding 2)
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = {
  searchMessages: vi.fn(),
  getMessageDetail: vi.fn(),
  deleteMessage: vi.fn(),
};

vi.mock('../../services/message-query.service.js', () => ({
  MessageQueryService: mockService,
}));

vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { MessageController } = await import('../message.controller.js');
const { emitEvent } = await import('../../lib/event-emitter.js');
const mockEmit = vi.mocked(emitEvent);

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ip: '10.0.0.7',
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageController — PHI audit', () => {
  it('emits MESSAGE_CONTENT_VIEWED with user + IP on successful detail read', async () => {
    mockService.getMessageDetail.mockResolvedValue({ ok: true, value: { messageId: 5, connectors: [] }, error: null });
    const res = makeRes();

    await MessageController.getDetail(makeReq({ params: { id: 'ch-1', msgId: '5' } as never }), res);

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'MESSAGE_CONTENT_VIEWED', userId: 'user-1', ipAddress: '10.0.0.7', channelId: 'ch-1' }),
    );
  });

  it('does NOT emit an audit event when the detail read fails', async () => {
    mockService.getMessageDetail.mockResolvedValue({ ok: false, value: null, error: { code: 'NOT_FOUND', message: 'x' } });
    const res = makeRes();

    await MessageController.getDetail(makeReq({ params: { id: 'ch-1', msgId: '5' } as never }), res);

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('emits MESSAGE_SEARCHED on a successful search', async () => {
    mockService.searchMessages.mockResolvedValue({ ok: true, value: { items: [], total: 0 }, error: null });
    const res = makeRes();

    await MessageController.search(makeReq({ params: { id: 'ch-1' } as never, query: {} as never }), res);

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'MESSAGE_SEARCHED', channelId: 'ch-1' }));
  });
});
