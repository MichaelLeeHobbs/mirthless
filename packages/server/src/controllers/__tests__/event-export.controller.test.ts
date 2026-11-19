// Every export is recorded before the file goes out (D-312).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const exportService = { exportAsCsv: vi.fn(), exportAsJson: vi.fn() };
vi.mock('../../services/event-export.service.js', () => ({ EventExportService: exportService }));
vi.mock('../../lib/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const recordExportOrRefuse = vi.fn();
vi.mock('../../lib/audited-read.js', () => ({ recordExportOrRefuse }));

const { EventExportController } = await import('../event-export.controller.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() } as unknown as Response;
}
const req = (query: Record<string, unknown>): Request => ({ query, user: { id: 'u1', username: 'kpatel' } }) as unknown as Request;
const body = (res: Response): string => String(vi.mocked(res.send).mock.calls[0]?.[0]);

beforeEach(() => {
  vi.clearAllMocks();
  recordExportOrRefuse.mockResolvedValue(9);
  exportService.exportAsCsv.mockResolvedValue({ ok: true, value: 'id,name\r\n1,X\r\n' });
  exportService.exportAsJson.mockResolvedValue({ ok: true, value: '[{"id":1}]' });
});

describe('EventExportController.exportEvents', () => {
  it('records the export with its reason and filters, then heads the CSV with the record', async () => {
    const res = makeRes();
    await EventExportController.exportEvents(req({ format: 'csv', maxRows: 100, reason: 'Incident 42' }), res);

    expect(recordExportOrRefuse).toHaveBeenCalledWith(expect.anything(), res, {
      action: 'EVENTS_EXPORTED', attributes: { reason: 'Incident 42', filters: { format: 'csv', maxRows: 100 } },
    });
    expect(body(res)).toMatch(/^# GalvaniGraph export\r\n/);
    expect(body(res)).toContain('# audit record: 9\r\n# reason: Incident 42\r\nid,name');
  });

  it('wraps a JSON export with the header', async () => {
    const res = makeRes();
    await EventExportController.exportEvents(req({ format: 'json', reason: 'Incident 42' }), res);

    expect(JSON.parse(body(res))).toMatchObject({ export: { auditRecordId: 9, exportedBy: 'kpatel' }, events: [{ id: 1 }] });
  });

  it('sends no file when the export cannot be recorded', async () => {
    recordExportOrRefuse.mockResolvedValueOnce(null);
    const res = makeRes();
    await EventExportController.exportEvents(req({ format: 'csv', reason: 'Incident 42' }), res);

    expect(res.send).not.toHaveBeenCalled();
  });

  it('records nothing when the export fails', async () => {
    exportService.exportAsCsv.mockResolvedValueOnce({ ok: false, error: new Error('db down') });
    const res = makeRes();
    await EventExportController.exportEvents(req({ format: 'csv', reason: 'Incident 42' }), res);

    expect(recordExportOrRefuse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
