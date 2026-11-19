// recordReadOrRefuse has its own tests (lib/__tests__/audited-read.test.ts).

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

vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

const recordReadOrRefuse = vi.fn();
vi.mock('../../lib/audited-read.js', () => ({ recordReadOrRefuse }));

const { MessageController } = await import('../message.controller.js');

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
  recordReadOrRefuse.mockResolvedValue(true);
});

describe('MessageController.getDetail', () => {
  it('records MESSAGE_CONTENT_VIEWED, deduped per message, then sends the detail', async () => {
    mockService.getMessageDetail.mockResolvedValue({ ok: true, value: { messageId: 5, connectors: [] }, error: null });
    const res = makeRes();

    await MessageController.getDetail(makeReq({ params: { id: 'ch-1', msgId: '5' } as never }), res);

    expect(recordReadOrRefuse).toHaveBeenCalledWith(expect.anything(), res, {
      action: 'MESSAGE_CONTENT_VIEWED', channelId: 'ch-1', attributes: { messageId: 5 },
      dedupe: { key: 'detail|ch-1|5', ids: [5] }, rows: 1,
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { messageId: 5, connectors: [] } });
    expect(recordReadOrRefuse.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(res.json).mock.invocationCallOrder[0] ?? 0);
  });

  it('sends nothing when the read cannot be recorded', async () => {
    mockService.getMessageDetail.mockResolvedValue({ ok: true, value: { messageId: 5, connectors: [] }, error: null });
    recordReadOrRefuse.mockResolvedValueOnce(false);
    const res = makeRes();

    await MessageController.getDetail(makeReq({ params: { id: 'ch-1', msgId: '5' } as never }), res);

    expect(res.json).not.toHaveBeenCalled();
  });

  it('records nothing when the read fails', async () => {
    mockService.getMessageDetail.mockResolvedValue({ ok: false, value: null, error: { code: 'NOT_FOUND', message: 'x' } });

    await MessageController.getDetail(makeReq({ params: { id: 'ch-1', msgId: '5' } as never }), makeRes());

    expect(recordReadOrRefuse).not.toHaveBeenCalled();
  });
});

describe('MessageController.search', () => {
  it('records MESSAGE_SEARCHED with the term as typed, the filters, the total and the returned ids', async () => {
    mockService.searchMessages.mockResolvedValue({ ok: true, value: { items: [{ messageId: 3 }, { messageId: 9 }], total: 2 }, error: null });
    const res = makeRes();
    const query = { contentSearch: 'Smith', status: ['ERROR'], limit: 25, offset: 0 };

    await MessageController.search(makeReq({ params: { id: 'ch-1' } as never, query: query as never }), res);

    expect(recordReadOrRefuse).toHaveBeenCalledWith(expect.anything(), res, {
      action: 'MESSAGE_SEARCHED', channelId: 'ch-1',
      attributes: { term: 'Smith', filters: { status: ['ERROR'], limit: 25, offset: 0 }, total: 2 },
      dedupe: { key: `search|ch-1|${JSON.stringify(query)}`, ids: [3, 9] }, rows: 2,
    });
    expect(res.json).toHaveBeenCalledOnce();
    expect(recordReadOrRefuse.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(res.json).mock.invocationCallOrder[0] ?? 0);
  });

  it('records a search with no term as a null term', async () => {
    mockService.searchMessages.mockResolvedValue({ ok: true, value: { items: [], total: 0 }, error: null });

    await MessageController.search(makeReq({ params: { id: 'ch-1' } as never, query: {} as never }), makeRes());

    expect(recordReadOrRefuse.mock.calls[0]?.[2]).toMatchObject({ attributes: { term: null, total: 0 } });
  });

  it('sends nothing when the search cannot be recorded', async () => {
    mockService.searchMessages.mockResolvedValue({ ok: true, value: { items: [], total: 0 }, error: null });
    recordReadOrRefuse.mockResolvedValueOnce(false);
    const res = makeRes();

    await MessageController.search(makeReq({ params: { id: 'ch-1' } as never, query: {} as never }), res);

    expect(res.json).not.toHaveBeenCalled();
  });
});
