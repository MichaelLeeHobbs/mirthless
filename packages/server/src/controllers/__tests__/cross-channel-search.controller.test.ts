// The Traffic page's list is recorded before it is sent (D-312).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const search = vi.fn();
vi.mock('../../services/cross-channel-search.service.js', () => ({ CrossChannelSearchService: { search } }));
vi.mock('../../lib/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const recordReadOrRefuse = vi.fn();
vi.mock('../../lib/audited-read.js', () => ({ recordReadOrRefuse }));

const { CrossChannelSearchController } = await import('../cross-channel-search.controller.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

const req = (query: Record<string, string>): Request => ({ query, user: { id: 'u1' } }) as unknown as Request;
const RESULT = { items: [{ channelId: 'c1', messageId: 4 }, { channelId: 'c2', messageId: 4 }], total: 2, limit: 25, offset: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  recordReadOrRefuse.mockResolvedValue(true);
});

describe('CrossChannelSearchController.search', () => {
  it('records the search with its filters, total and channel-qualified ids, then sends the list', async () => {
    search.mockResolvedValue({ ok: true, value: RESULT });
    const res = makeRes();

    await CrossChannelSearchController.search(req({ status: 'ERROR' }), res);

    const filters = { limit: 25, offset: 0, status: 'ERROR' };
    expect(recordReadOrRefuse).toHaveBeenCalledWith(expect.anything(), res, {
      action: 'MESSAGES_SEARCHED_ALL_CHANNELS', attributes: { filters, total: 2 },
      dedupe: { key: `traffic|${JSON.stringify(filters)}`, ids: ['c1:4', 'c2:4'] }, rows: 2,
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: RESULT });
    expect(recordReadOrRefuse.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(res.json).mock.invocationCallOrder[0] ?? 0);
  });

  it('sends nothing when the search cannot be recorded', async () => {
    search.mockResolvedValue({ ok: true, value: RESULT });
    recordReadOrRefuse.mockResolvedValueOnce(false);
    const res = makeRes();

    await CrossChannelSearchController.search(req({}), res);

    expect(res.json).not.toHaveBeenCalled();
  });

  it('records nothing when the search fails', async () => {
    search.mockResolvedValue({ ok: false, error: new Error('db down') });
    const res = makeRes();

    await CrossChannelSearchController.search(req({}), res);

    expect(recordReadOrRefuse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
