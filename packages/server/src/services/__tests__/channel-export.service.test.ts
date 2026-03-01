// ===========================================
// Channel Export Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the channel service
vi.mock('../channel.service.js', () => ({
  ChannelService: {
    getById: vi.fn(),
    list: vi.fn(),
  },
}));

import { ChannelExportService } from '../channel-export.service.js';
import { ChannelService } from '../channel.service.js';

const mockGetById = vi.mocked(ChannelService.getById);
const mockList = vi.mocked(ChannelService.list);

// ----- Helpers -----

function makeChannelDetail(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'ch-001',
    name: 'Test Channel',
    description: 'A test channel',
    enabled: true,
    revision: 1,
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: { host: '0.0.0.0', port: 6661 },
    responseMode: 'NONE',
    responseConnectorName: null,
    initialState: 'STARTED',
    messageStorageMode: 'DEVELOPMENT',
    encryptData: false,
    removeContentOnCompletion: false,
    removeAttachmentsOnCompletion: false,
    pruningEnabled: false,
    pruningMaxAgeDays: null,
    pruningArchiveEnabled: false,
    scripts: [
      { id: 's1', scriptType: 'DEPLOY', script: '' },
      { id: 's2', scriptType: 'UNDEPLOY', script: '' },
    ],
    destinations: [
      {
        id: 'd1', metaDataId: 1, name: 'Dest 1', enabled: true,
        connectorType: 'HTTP', properties: { url: 'http://localhost' },
        queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10000,
        rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
      },
    ],
    metadataColumns: [],
    tags: [],
    filters: [],
    transformers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- exportChannel -----

describe('ChannelExportService.exportChannel', () => {
  it('exports a single channel successfully', async () => {
    const detail = makeChannelDetail();
    mockGetById.mockResolvedValue({ ok: true, value: detail as never, error: null });

    const result = await ChannelExportService.exportChannel('ch-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.version).toBe(1);
      expect(result.value.channels).toHaveLength(1);
      expect(result.value.channels[0]?.id).toBe('ch-001');
      expect(result.value.channels[0]?.name).toBe('Test Channel');
      expect(result.value.exportedAt).toBeDefined();
    }
  });

  it('includes scripts in export', async () => {
    const detail = makeChannelDetail();
    mockGetById.mockResolvedValue({ ok: true, value: detail as never, error: null });

    const result = await ChannelExportService.exportChannel('ch-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const exported = result.value.channels[0];
      expect(exported?.scripts).toHaveLength(2);
      expect(exported?.scripts[0]).toEqual({ scriptType: 'DEPLOY', script: '' });
    }
  });

  it('includes destinations in export', async () => {
    const detail = makeChannelDetail();
    mockGetById.mockResolvedValue({ ok: true, value: detail as never, error: null });

    const result = await ChannelExportService.exportChannel('ch-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const exported = result.value.channels[0];
      expect(exported?.destinations).toHaveLength(1);
      expect(exported?.destinations[0]?.name).toBe('Dest 1');
      expect(exported?.destinations[0]?.connectorType).toBe('HTTP');
    }
  });

  it('strips internal IDs from scripts and destinations', async () => {
    const detail = makeChannelDetail();
    mockGetById.mockResolvedValue({ ok: true, value: detail as never, error: null });

    const result = await ChannelExportService.exportChannel('ch-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const exported = result.value.channels[0];
      // Scripts should NOT have 'id' field
      expect(exported?.scripts[0]).not.toHaveProperty('id');
      // Destinations should NOT have 'id' field
      expect(exported?.destinations[0]).not.toHaveProperty('id');
    }
  });

  it('returns error when channel not found', async () => {
    mockGetById.mockResolvedValue({
      ok: false,
      value: null,
      error: { name: 'ServiceError', message: 'Channel not found', code: 'NOT_FOUND' },
    });

    const result = await ChannelExportService.exportChannel('nonexistent');
    expect(result.ok).toBe(false);
  });

  it('includes filters and transformers in export', async () => {
    const detail = makeChannelDetail({
      filters: [{
        id: 'f1', connectorId: null,
        rules: [{ id: 'r1', sequenceNumber: 0, enabled: true, name: 'Rule 1', operator: 'AND', type: 'JAVASCRIPT', script: 'true', field: null, condition: null, values: null }],
      }],
      transformers: [{
        id: 't1', connectorId: null,
        inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
        inboundProperties: {}, outboundProperties: {},
        inboundTemplate: null, outboundTemplate: null,
        steps: [{ id: 's1', sequenceNumber: 0, enabled: true, name: 'Step 1', type: 'JAVASCRIPT', script: 'return msg;', sourceField: null, targetField: null, defaultValue: null, mapping: null }],
      }],
    });
    mockGetById.mockResolvedValue({ ok: true, value: detail as never, error: null });

    const result = await ChannelExportService.exportChannel('ch-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const exported = result.value.channels[0];
      expect(exported?.filters).toHaveLength(1);
      expect(exported?.filters[0]?.rules).toHaveLength(1);
      expect(exported?.transformers).toHaveLength(1);
      expect(exported?.transformers[0]?.steps).toHaveLength(1);
    }
  });
});

// ----- exportAll -----

describe('ChannelExportService.exportAll', () => {
  it('exports all channels', async () => {
    mockList.mockResolvedValue({
      ok: true,
      value: {
        data: [
          { id: 'ch-1', name: 'Channel 1' },
          { id: 'ch-2', name: 'Channel 2' },
        ],
        pagination: { page: 1, pageSize: 10000, total: 2, totalPages: 1 },
      } as never,
      error: null,
    });

    mockGetById.mockImplementation(async (id) => ({
      ok: true as const,
      value: makeChannelDetail({ id, name: `Channel ${id}` }) as never,
      error: null,
    }));

    const result = await ChannelExportService.exportAll();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channels).toHaveLength(2);
    }
  });

  it('skips channels that fail to load', async () => {
    mockList.mockResolvedValue({
      ok: true,
      value: {
        data: [
          { id: 'ch-1', name: 'Channel 1' },
          { id: 'ch-2', name: 'Channel 2' },
        ],
        pagination: { page: 1, pageSize: 10000, total: 2, totalPages: 1 },
      } as never,
      error: null,
    });

    let callCount = 0;
    mockGetById.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true as const, value: makeChannelDetail({ id: 'ch-1' }) as never, error: null };
      }
      return { ok: false as const, value: null, error: { name: 'Error', message: 'DB error', code: 'INTERNAL' } };
    });

    const result = await ChannelExportService.exportAll();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channels).toHaveLength(1);
    }
  });

  it('returns error when list fails', async () => {
    mockList.mockResolvedValue({
      ok: false,
      value: null,
      error: { name: 'Error', message: 'DB error', code: 'INTERNAL' },
    });

    const result = await ChannelExportService.exportAll();
    expect(result.ok).toBe(false);
  });
});
