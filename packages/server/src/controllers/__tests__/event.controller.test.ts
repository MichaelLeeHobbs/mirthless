import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = { list: vi.fn(), getById: vi.fn(), purge: vi.fn() };

vi.mock('../../services/event.service.js', () => ({ EventService: mockService }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { EventController } = await import('../event.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(): Request {
  return { query: { olderThanDays: 30 }, user: { id: 'u1' }, ip: '10.0.0.1' } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EventController.purge', () => {
  it('answers 400 with the service error for invalid input', async () => {
    mockService.purge.mockResolvedValue({ ok: false, value: null, error: new ServiceError('INVALID_INPUT', 'olderThanDays must be positive') });
    const res = makeRes();

    await EventController.purge(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INVALID_INPUT', message: 'olderThanDays must be positive' } });
  });

  it('answers 404 for a NOT_FOUND service error', async () => {
    mockService.purge.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Nothing to purge') });
    const res = makeRes();

    await EventController.purge(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('answers 500 with a generic body for an error that is not a service error', async () => {
    mockService.purge.mockResolvedValue({ ok: false, value: null, error: new Error('connection refused') });
    const res = makeRes();

    await EventController.purge(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  it('returns the purge count on success', async () => {
    mockService.purge.mockResolvedValue({ ok: true, value: { deleted: 4 }, error: null });
    const res = makeRes();

    await EventController.purge(makeReq(), res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: 4 } });
  });
});
