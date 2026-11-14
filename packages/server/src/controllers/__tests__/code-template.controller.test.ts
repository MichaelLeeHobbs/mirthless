// ===========================================
// Code Template Controller Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = { createTemplate: vi.fn(), updateTemplate: vi.fn() };

vi.mock('../../services/code-template.service.js', () => ({ CodeTemplateService: mockService }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { CodeTemplateController } = await import('../code-template.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(): Request {
  return { params: { id: 't1' }, query: {}, body: { name: 'pad', code: 'function pad( {' }, ip: '10.0.0.1', user: { id: 'u1' } } as unknown as Request;
}

// A template whose code does not compile is the client's mistake (400), as for global scripts.
const compileError = new ServiceError('INVALID_INPUT', 'Template code does not compile: Unexpected token');

describe('CodeTemplateController template writes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 with the compile error when creating a template that does not compile', async () => {
    mockService.createTemplate.mockResolvedValue({ ok: false, value: null, error: compileError });
    const res = makeRes();

    await CodeTemplateController.createTemplate(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INVALID_INPUT', message: compileError.message } });
  });

  it('returns 400 when updating a template with code that does not compile', async () => {
    mockService.updateTemplate.mockResolvedValue({ ok: false, value: null, error: compileError });
    const res = makeRes();

    await CodeTemplateController.updateTemplate(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 without the internal message for an unexpected failure', async () => {
    mockService.createTemplate.mockResolvedValue({ ok: false, value: null, error: new Error('connection reset') });
    const res = makeRes();

    await CodeTemplateController.createTemplate(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});
