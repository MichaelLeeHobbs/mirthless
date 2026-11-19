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

const recordExportOrRefuse = vi.fn();
vi.mock('../../lib/audited-read.js', () => ({ recordExportOrRefuse }));

const { MessageExportController } = await import('../message-export.controller.js');

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
  recordExportOrRefuse.mockResolvedValue(41);
});

describe('MessageExportController.exportMessages', () => {
  it('records MESSAGES_EXPORTED with every exported id, never deduped, before the file', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false, reason: 'Quarterly review' }), res);

    expect(recordExportOrRefuse).toHaveBeenCalledWith(expect.anything(), res, {
      action: 'MESSAGES_EXPORTED', channelId: 'ch-1',
      attributes: { reason: 'Quarterly review', format: 'csv', exported: 1, total: 1, truncated: false, includeContent: false, messageIds: [1] },
      rows: 1,
    });
    expect(recordExportOrRefuse.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(res.send).mock.invocationCallOrder[0] ?? 0);
  });

  it('heads the CSV with the export header, naming the audit record and the reason', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false, reason: 'Quarterly review' }), res);

    const body = String(vi.mocked(res.send).mock.calls[0]?.[0]);
    expect(body).toMatch(/^# GalvaniGraph export\r\n/);
    expect(body).toContain('# audit record: 41\r\n# reason: Quarterly review\r\nCSV_BODY');
  });

  it('wraps the JSON rows with the export header', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    mockService.toJson.mockReturnValueOnce('[{"messageId":1}]');
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'json', includeContent: false, reason: 'Quarterly review' }), res);

    const parsed = JSON.parse(String(vi.mocked(res.send).mock.calls[0]?.[0])) as { export: Record<string, unknown>; messages: unknown[] };
    expect(parsed.export).toMatchObject({ auditRecordId: 41, reason: 'Quarterly review', exportedBy: 'user-5' });
    expect(parsed.messages).toEqual([{ messageId: 1 }]);
  });

  it('sends no file when the export cannot be recorded', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    recordExportOrRefuse.mockResolvedValueOnce(null);
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false }), res);

    expect(res.send).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('returns a CSV body with attachment + truncation headers', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false }), res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(res.setHeader).toHaveBeenCalledWith('X-Export-Truncated', 'false');
    expect(res.setHeader).toHaveBeenCalledWith('X-Export-Count', '1');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('.csv'));
    expect(res.send).toHaveBeenCalledWith(expect.stringMatching(/CSV_BODY$/));
  });

  it('returns a JSON body for format=json', async () => {
    mockService.collect.mockResolvedValue({ ok: true, value: okData, error: null });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'json', includeContent: false }), res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('"messages": JSON_BODY'));
    expect(mockService.toJson).toHaveBeenCalled();
  });

  it('does NOT emit an audit event and returns an error status when collect fails', async () => {
    mockService.collect.mockResolvedValue({ ok: false, value: null, error: { code: 'INTERNAL', message: 'boom' } });
    const res = makeRes();

    await MessageExportController.exportMessages(makeReq({ format: 'csv', includeContent: false }), res);

    expect(recordExportOrRefuse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
