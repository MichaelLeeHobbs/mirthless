// ===========================================
// Attachment Controller Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = { listByMessage: vi.fn(), getById: vi.fn() };

vi.mock('../../services/attachment.service.js', () => ({ AttachmentService: mockService }));
const recordReadOrRefuse = vi.fn();
vi.mock('../../lib/audited-read.js', () => ({ recordReadOrRefuse }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { AttachmentController } = await import('../attachment.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(): Request {
  return {
    params: { id: '00000000-0000-0000-0000-000000000001', msgId: '5' },
    user: { id: 'u1' },
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  recordReadOrRefuse.mockResolvedValue(true);
});

describe('AttachmentController.getById', () => {
  const req = (): Request => ({
    params: { id: 'ch-1', msgId: '5', attachmentId: 'a1' }, user: { id: 'u1' },
  }) as unknown as Request;

  it('records ATTACHMENT_DOWNLOADED, every time, before sending the attachment', async () => {
    mockService.getById.mockResolvedValue({ ok: true, value: { id: 'a1', content: 'x' }, error: null });
    const res = makeRes();

    await AttachmentController.getById(req(), res);

    expect(recordReadOrRefuse).toHaveBeenCalledWith(expect.anything(), res, {
      action: 'ATTACHMENT_DOWNLOADED', channelId: 'ch-1', attributes: { messageId: 5, attachmentId: 'a1' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'a1', content: 'x' } });
  });

  it('sends nothing when the download cannot be recorded', async () => {
    mockService.getById.mockResolvedValue({ ok: true, value: { id: 'a1', content: 'x' }, error: null });
    recordReadOrRefuse.mockResolvedValueOnce(false);
    const res = makeRes();

    await AttachmentController.getById(req(), res);

    expect(res.json).not.toHaveBeenCalled();
  });

  it('records nothing when the attachment is not found', async () => {
    mockService.getById.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'no attachment') });

    await AttachmentController.getById(req(), makeRes());

    expect(recordReadOrRefuse).not.toHaveBeenCalled();
  });
});

describe('AttachmentController.list', () => {
  it('answers 404 with the service error when the message does not exist', async () => {
    mockService.listByMessage.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Message not found') });
    const res = makeRes();

    await AttachmentController.list(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Message not found' } });
  });

  it('answers 500 with a generic body for an error that is not a service error', async () => {
    mockService.listByMessage.mockResolvedValue({ ok: false, value: null, error: new Error('connection refused') });
    const res = makeRes();

    await AttachmentController.list(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  it('returns the attachments on success', async () => {
    mockService.listByMessage.mockResolvedValue({ ok: true, value: [{ id: 'a1' }], error: null });
    const res = makeRes();

    await AttachmentController.list(makeReq(), res);

    expect(mockService.listByMessage).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 5);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'a1' }] });
  });
});
