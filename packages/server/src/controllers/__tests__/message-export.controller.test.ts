// ===========================================
// Message Export Controller Tests — PHI audit + headers
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = {
  collect: vi.fn(),
  toCsv: vi.fn().mockReturnValue('CSV_BODY'),
  toJson: vi.fn().mockReturnValue('JSON_BODY'),
};

vi.mock('../../services/message-export.service.js', () => ({
  MessageExportService: mockService,
}));

vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

const { MessageExportController } = await import('../message-export.controller.js');
const { emitEvent } = await import('../../lib/event-emitter.js');
const mockEmit = vi.mocked(emitEvent);

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(query: Record<string, unknown>): Request {
  return {
    params: { id: 'ch-1' }, query, body: {}, ip: '10.0.0.5', user: { id: 'user-5' },
  } as unknown as Request;
}

const okData = { rows: [{ messageId: 1 }], total: 1, truncated: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockService.toCsv.mockReturnValue('CSV_BODY');
  mockService.toJson.mockReturnValue('JSON_BODY');
});

describe('MessageExportController.exportMessages', () => {
  it('emits a MESSAGES_EXPORTED audit event with user + IP + channel', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false }), res);

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'MESSAGES_EXPORTED', userId: 'user-5', ipAddress: '10.0.0.5', channelId: 'ch-1' }),
    );
  });

  it('returns a CSV body with attachment + truncation headers', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false }), res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(res.setHeader).toHaveBeenCalledWith('X-Export-Truncated', 'false');
    expect(res.setHeader).toHaveBeenCalledWith('X-Export-Count', '1');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('.csv'));
    expect(res.send).toHaveBeenCalledWith('CSV_BODY');
  });

  it('returns a JSON body for format=json', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'json', includeContent: false }), res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.send).toHaveBeenCalledWith('JSON_BODY');
    expect(mockService.toJson).toHaveBeenCalled();
  });

  it('does NOT emit an audit event and returns an error status when collect fails', async () => {
    mockService.collect.mockResolvedValue({ ok: false, value: null, error: { code: 'INTERNAL', message: 'boom' } });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false }), res);

    expect(mockEmit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
