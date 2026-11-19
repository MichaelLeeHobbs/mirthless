// exportInfo comes first; the recorded hash covers the rest (D-318).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const exportBackup = vi.fn();
vi.mock('../../services/server-backup.service.js', () => ({ ServerBackupService: { exportBackup } }));
vi.mock('../../lib/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { ServerBackupController } = await import('../server-backup.controller.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}
const req = { query: { reason: 'Monthly backup' }, user: { id: 'u1', username: 'kpatel' }, ip: '10.0.0.7' } as unknown as Request;

beforeEach(() => { vi.clearAllMocks(); });

describe('ServerBackupController.exportBackup', () => {
  it('passes the reason to the service and answers with exportInfo first, then the backup', async () => {
    exportBackup.mockResolvedValue({ ok: true, value: { backup: { version: 1, channels: [] }, auditRecordId: 12 } });
    const res = makeRes();

    await ServerBackupController.exportBackup(req, res);

    expect(exportBackup).toHaveBeenCalledWith('Monthly backup', { userId: 'u1', ipAddress: '10.0.0.7' });
    const body = vi.mocked(res.json).mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(Object.keys(body.data)).toEqual(['exportInfo', 'version', 'channels']);
    expect(body.data['exportInfo']).toMatchObject({ auditRecordId: 12, reason: 'Monthly backup', exportedBy: 'kpatel' });
  });

  it('answers the service error, such as AUDIT_UNAVAILABLE, with no backup', async () => {
    exportBackup.mockResolvedValue({ ok: false, error: Object.assign(new Error('refused'), { name: 'ServiceError', code: 'AUDIT_UNAVAILABLE' }) });
    const res = makeRes();

    await ServerBackupController.exportBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'AUDIT_UNAVAILABLE', message: 'refused' } });
  });
});
