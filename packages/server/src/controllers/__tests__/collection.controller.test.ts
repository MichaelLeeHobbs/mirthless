// ===========================================
// Collection Controller Tests (record grid)
// ===========================================
// The record list/create/update/delete handlers map service Results onto the
// API envelope and HTTP status. The SQL itself is covered by
// collection.itest.ts against Postgres.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = {
  listRecords: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
};

vi.mock('../../services/collection.service.js', () => ({ CollectionService: mockService }));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { CollectionController } = await import('../collection.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

const COLLECTION_ID = '00000000-0000-4000-8000-000000000001';
const RECORD_ID = '00000000-0000-4000-8000-000000000002';
const RECORD = { id: RECORD_ID, fields: { accession: 'A1' }, payload: 'p', expireAt: null, createdAt: new Date() };

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: COLLECTION_ID, recordId: RECORD_ID },
    query: {},
    body: {},
    ip: '10.0.0.1',
    user: { id: 'u1' },
    ...overrides,
  } as unknown as Request;
}

const fail = (code: string): { ok: false; error: InstanceType<typeof ServiceError> } => ({ ok: false, error: new ServiceError(code as 'NOT_FOUND', 'nope') });

beforeEach(() => { vi.clearAllMocks(); });

describe('CollectionController.listRecords', () => {
  it('passes the parsed query to the service and returns the page', async () => {
    const query = { page: 2, pageSize: 25, sort: 'fields.accession', order: 'asc', q: 'A' };
    mockService.listRecords.mockResolvedValue({ ok: true, value: { items: [RECORD], total: 26 } });
    const res = makeRes();
    await CollectionController.listRecords(makeReq({ query: query as unknown as Request['query'] }), res);
    expect(mockService.listRecords).toHaveBeenCalledWith(COLLECTION_ID, query);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [RECORD], total: 26 } });
  });

  it('returns 404 when the collection does not exist', async () => {
    mockService.listRecords.mockResolvedValue(fail('NOT_FOUND'));
    const res = makeRes();
    await CollectionController.listRecords(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 for a sort column the collection does not index', async () => {
    mockService.listRecords.mockResolvedValue(fail('INVALID_INPUT'));
    const res = makeRes();
    await CollectionController.listRecords(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('CollectionController.createRecord', () => {
  it('returns 201 with the record and passes the audit context', async () => {
    mockService.createRecord.mockResolvedValue({ ok: true, value: RECORD });
    const body = { fields: { accession: 'A1' }, payload: 'p' };
    const res = makeRes();
    await CollectionController.createRecord(makeReq({ body }), res);
    expect(mockService.createRecord).toHaveBeenCalledWith(COLLECTION_ID, body, { userId: 'u1', ipAddress: '10.0.0.1' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: RECORD });
  });

  it('returns 400 when the service rejects the fields', async () => {
    mockService.createRecord.mockResolvedValue(fail('INVALID_INPUT'));
    const res = makeRes();
    await CollectionController.createRecord(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('CollectionController.updateRecord', () => {
  it('updates the record named in the URL', async () => {
    mockService.updateRecord.mockResolvedValue({ ok: true, value: RECORD });
    const body = { fields: {}, payload: 'p', expireAt: null };
    const res = makeRes();
    await CollectionController.updateRecord(makeReq({ body }), res);
    expect(mockService.updateRecord).toHaveBeenCalledWith(COLLECTION_ID, RECORD_ID, body, { userId: 'u1', ipAddress: '10.0.0.1' });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: RECORD });
  });

  it('returns 404 when the record is not in this collection', async () => {
    mockService.updateRecord.mockResolvedValue(fail('NOT_FOUND'));
    const res = makeRes();
    await CollectionController.updateRecord(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('CollectionController.deleteRecord', () => {
  it('returns 204 on delete', async () => {
    mockService.deleteRecord.mockResolvedValue({ ok: true, value: undefined });
    const res = makeRes();
    await CollectionController.deleteRecord(makeReq(), res);
    expect(mockService.deleteRecord).toHaveBeenCalledWith(COLLECTION_ID, RECORD_ID, { userId: 'u1', ipAddress: '10.0.0.1' });
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 500 without leaking the message on an unexpected error', async () => {
    mockService.deleteRecord.mockResolvedValue({ ok: false, error: new Error('connection reset') });
    const res = makeRes();
    await CollectionController.deleteRecord(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});
