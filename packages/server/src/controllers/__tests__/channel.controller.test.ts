// ===========================================
// Channel Controller Tests
// ===========================================
// Tests controller response format and error handling.
// Verifies the API contract between server and frontend.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ----- Mock Service -----

const mockService = {
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  setEnabled: vi.fn(),
};

vi.mock('../../services/channel.service.js', () => ({
  ChannelService: mockService,
}));

vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { ChannelController } = await import('../channel.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

// ----- Helpers -----

function makeRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as Request;
}

function makeChannelDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Channel',
    description: 'A test channel',
    enabled: false,
    revision: 1,
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    sourceConnectorType: 'TCP_MLLP',
    responseMode: 'AUTO_AFTER_DESTINATIONS',
    responseConnectorName: null,
    initialState: 'STOPPED',
    messageStorageMode: 'DEVELOPMENT',
    encryptData: false,
    sourceConnectorProperties: {},
    scripts: [],
    destinations: [],
    metadataColumns: [],
    tags: [],
    createdAt: new Date('2026-02-26T12:00:00Z'),
    updatedAt: new Date('2026-02-26T12:00:00Z'),
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelController', () => {
  // ========== LIST ==========
  describe('list', () => {
    it('returns nested data with pagination matching frontend ChannelListResponse type', async () => {
      const channels = [
        makeChannelDetail({ id: 'id-1', name: 'Channel A' }),
        makeChannelDetail({ id: 'id-2', name: 'Channel B' }),
      ];
      const listResult = {
        data: channels,
        pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      };

      mockService.list.mockResolvedValue({ ok: true, value: listResult, error: null });

      const req = makeReq({ query: { page: 1, pageSize: 25 } as unknown as Request['query'] });
      const res = makeRes();

      await ChannelController.list(req, res);

      // Verify the response structure the frontend expects:
      // { success: true, data: { data: [...], pagination: {...} } }
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: listResult,
      });

      // Extract the actual call argument and verify it's nested correctly
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(response['success']).toBe(true);

      const data = response['data'] as { data: unknown[]; pagination: unknown };
      expect(data.data).toHaveLength(2);
      expect(data.pagination).toEqual({ page: 1, pageSize: 25, total: 2, totalPages: 1 });
    });

    it('returns 500 on service failure', async () => {
      mockService.list.mockResolvedValue({
        ok: false,
        value: null,
        error: new Error('DB timeout'),
      });

      const req = makeReq({ query: { page: 1, pageSize: 25 } as unknown as Request['query'] });
      const res = makeRes();

      await ChannelController.list(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });
  });

  // ========== GET BY ID ==========
  describe('getById', () => {
    it('returns channel detail in standard ApiResponse format', async () => {
      const channel = makeChannelDetail();

      mockService.getById.mockResolvedValue({ ok: true, value: channel, error: null });

      const req = makeReq({ params: { id: '00000000-0000-0000-0000-000000000001' } as Request['params'] });
      const res = makeRes();

      await ChannelController.getById(req, res);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(response['success']).toBe(true);
      expect(response['data']).toBeDefined();

      const data = response['data'] as Record<string, unknown>;
      expect(data['id']).toBe('00000000-0000-0000-0000-000000000001');
      expect(data['scripts']).toBeDefined();
      expect(data['destinations']).toBeDefined();
    });

    it('returns 404 for NOT_FOUND error', async () => {
      const error = new ServiceError('NOT_FOUND', 'Channel not found');
      mockService.getById.mockResolvedValue({ ok: false, value: null, error });

      const req = makeReq({ params: { id: '00000000-0000-0000-0000-000000000099' } as Request['params'] });
      const res = makeRes();

      await ChannelController.getById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ========== CREATE ==========
  describe('create', () => {
    it('returns 201 with channel detail after successful creation', async () => {
      const channel = makeChannelDetail({ name: 'New Channel' });

      mockService.create.mockResolvedValue({ ok: true, value: channel, error: null });

      const req = makeReq({
        body: {
          name: 'New Channel',
          inboundDataType: 'HL7V2',
          outboundDataType: 'HL7V2',
          sourceConnectorType: 'TCP_MLLP',
          sourceConnectorProperties: {},
          responseMode: 'AUTO_AFTER_DESTINATIONS',
        },
      });
      const res = makeRes();

      await ChannelController.create(req, res);

      expect(res.status).toHaveBeenCalledWith(201);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(response['success']).toBe(true);

      const data = response['data'] as Record<string, unknown>;
      expect(data['id']).toBeDefined();
      expect(data['name']).toBe('New Channel');
    });

    it('returns 409 for ALREADY_EXISTS error', async () => {
      const error = new ServiceError('ALREADY_EXISTS', 'Channel with name "X" already exists');
      mockService.create.mockResolvedValue({ ok: false, value: null, error });

      const req = makeReq({ body: { name: 'X' } });
      const res = makeRes();

      await ChannelController.create(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  // ========== UPDATE ==========
  describe('update', () => {
    it('returns updated channel detail', async () => {
      const channel = makeChannelDetail({ name: 'Updated', revision: 2 });

      mockService.update.mockResolvedValue({ ok: true, value: channel, error: null });

      const req = makeReq({
        params: { id: '00000000-0000-0000-0000-000000000001' } as Request['params'],
        body: { name: 'Updated', revision: 1 },
      });
      const res = makeRes();

      await ChannelController.update(req, res);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(response['success']).toBe(true);

      const data = response['data'] as Record<string, unknown>;
      expect(data['name']).toBe('Updated');
      expect(data['revision']).toBe(2);
    });

    it('returns 409 for CONFLICT error (revision mismatch)', async () => {
      const error = new ServiceError('CONFLICT', 'Revision mismatch');
      mockService.update.mockResolvedValue({ ok: false, value: null, error });

      const req = makeReq({
        params: { id: '00000000-0000-0000-0000-000000000001' } as Request['params'],
        body: { name: 'X', revision: 1 },
      });
      const res = makeRes();

      await ChannelController.update(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 404 for NOT_FOUND error', async () => {
      const error = new ServiceError('NOT_FOUND', 'Channel not found');
      mockService.update.mockResolvedValue({ ok: false, value: null, error });

      const req = makeReq({
        params: { id: '00000000-0000-0000-0000-000000000099' } as Request['params'],
        body: { name: 'X', revision: 1 },
      });
      const res = makeRes();

      await ChannelController.update(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ========== DELETE ==========
  describe('delete', () => {
    it('returns 204 on successful delete', async () => {
      mockService.delete.mockResolvedValue({ ok: true, value: undefined, error: null });

      const req = makeReq({
        params: { id: '00000000-0000-0000-0000-000000000001' } as Request['params'],
      });
      const res = makeRes();

      await ChannelController.delete(req, res);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    it('returns 404 for NOT_FOUND error', async () => {
      const error = new ServiceError('NOT_FOUND', 'Channel not found');
      mockService.delete.mockResolvedValue({ ok: false, value: null, error });

      const req = makeReq({
        params: { id: '00000000-0000-0000-0000-000000000099' } as Request['params'],
      });
      const res = makeRes();

      await ChannelController.delete(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ========== SET ENABLED ==========
  describe('setEnabled', () => {
    it('returns channel detail after toggling enabled', async () => {
      const channel = makeChannelDetail({ enabled: true });

      mockService.setEnabled.mockResolvedValue({ ok: true, value: channel, error: null });

      const req = makeReq({
        params: { id: '00000000-0000-0000-0000-000000000001' } as Request['params'],
        body: { enabled: true },
      });
      const res = makeRes();

      await ChannelController.setEnabled(req, res);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(response['success']).toBe(true);

      const data = response['data'] as Record<string, unknown>;
      expect(data['enabled']).toBe(true);
    });
  });

  // ========== WORKFLOW: Create → Get → Update → List → Delete ==========
  describe('workflow: full channel lifecycle', () => {
    it('creates, retrieves, updates, lists, and deletes a channel', async () => {
      const channelV1 = makeChannelDetail({ name: 'Lifecycle Channel', revision: 1 });
      const channelV2 = makeChannelDetail({ name: 'Lifecycle Channel (Updated)', revision: 2, enabled: true });

      // Step 1: Create
      mockService.create.mockResolvedValue({ ok: true, value: channelV1, error: null });

      const createReq = makeReq({
        body: {
          name: 'Lifecycle Channel',
          inboundDataType: 'HL7V2',
          outboundDataType: 'HL7V2',
          sourceConnectorType: 'TCP_MLLP',
          sourceConnectorProperties: {},
        },
      });
      const createRes = makeRes();
      await ChannelController.create(createReq, createRes);

      expect(createRes.status).toHaveBeenCalledWith(201);
      const createResponse = (createRes.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { id: string } };
      const channelId = createResponse.data.id;
      expect(channelId).toBeDefined();

      // Step 2: Get by ID
      mockService.getById.mockResolvedValue({ ok: true, value: channelV1, error: null });

      const getReq = makeReq({ params: { id: channelId } as Request['params'] });
      const getRes = makeRes();
      await ChannelController.getById(getReq, getRes);

      const getResponse = (getRes.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { success: boolean; data: { name: string } };
      expect(getResponse.success).toBe(true);
      expect(getResponse.data.name).toBe('Lifecycle Channel');

      // Step 3: Update
      mockService.update.mockResolvedValue({ ok: true, value: channelV2, error: null });

      const updateReq = makeReq({
        params: { id: channelId } as Request['params'],
        body: { name: 'Lifecycle Channel (Updated)', enabled: true, revision: 1 },
      });
      const updateRes = makeRes();
      await ChannelController.update(updateReq, updateRes);

      const updateResponse = (updateRes.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { success: boolean; data: { revision: number; name: string } };
      expect(updateResponse.success).toBe(true);
      expect(updateResponse.data.revision).toBe(2);
      expect(updateResponse.data.name).toBe('Lifecycle Channel (Updated)');

      // Step 4: List (verify response structure for frontend)
      const listResult = {
        data: [channelV2],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      };
      mockService.list.mockResolvedValue({ ok: true, value: listResult, error: null });

      const listReq = makeReq({ query: { page: 1, pageSize: 25 } as unknown as Request['query'] });
      const listRes = makeRes();
      await ChannelController.list(listReq, listRes);

      const listResponse = (listRes.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        success: boolean;
        data: { data: unknown[]; pagination: { total: number } };
      };
      expect(listResponse.success).toBe(true);
      expect(listResponse.data.data).toHaveLength(1);
      expect(listResponse.data.pagination.total).toBe(1);

      // Step 5: Delete
      mockService.delete.mockResolvedValue({ ok: true, value: undefined, error: null });

      const deleteReq = makeReq({ params: { id: channelId } as Request['params'] });
      const deleteRes = makeRes();
      await ChannelController.delete(deleteReq, deleteRes);

      expect(deleteRes.status).toHaveBeenCalledWith(204);

      // Step 6: Verify not found after delete
      const notFoundError = new ServiceError('NOT_FOUND', 'Channel not found');
      mockService.getById.mockResolvedValue({ ok: false, value: null, error: notFoundError });

      const getAfterDeleteReq = makeReq({ params: { id: channelId } as Request['params'] });
      const getAfterDeleteRes = makeRes();
      await ChannelController.getById(getAfterDeleteReq, getAfterDeleteRes);

      expect(getAfterDeleteRes.status).toHaveBeenCalledWith(404);
    });
  });
});
