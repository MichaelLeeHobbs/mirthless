// ===========================================
// Channel Export Controller Tests (single export)
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockExport = { exportChannel: vi.fn(), exportAll: vi.fn() };

vi.mock('../../services/channel-export.service.js', () => ({ ChannelExportService: mockExport }));
vi.mock('../../services/channel-import.service.js', () => ({ ChannelImportService: { importChannels: vi.fn() } }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { ChannelExportController } = await import('../channel-export.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(): Request {
  return { params: { id: '00000000-0000-0000-0000-000000000001' }, user: { id: 'u1' }, ip: '10.0.0.1' } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelExportController.exportChannel', () => {
  it('answers 404 with the service error when the channel does not exist', async () => {
    mockExport.exportChannel.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Channel 1 not found') });
    const res = makeRes();

    await ChannelExportController.exportChannel(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Channel 1 not found' } });
  });

  it('answers 400 for an INVALID_INPUT service error instead of 500', async () => {
    mockExport.exportChannel.mockResolvedValue({ ok: false, value: null, error: new ServiceError('INVALID_INPUT', 'Channel cannot be exported') });
    const res = makeRes();

    await ChannelExportController.exportChannel(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INVALID_INPUT', message: 'Channel cannot be exported' } });
  });

  it('answers 500 with a generic body for an error that is not a service error', async () => {
    mockExport.exportChannel.mockResolvedValue({ ok: false, value: null, error: new Error('connection refused') });
    const res = makeRes();

    await ChannelExportController.exportChannel(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});
