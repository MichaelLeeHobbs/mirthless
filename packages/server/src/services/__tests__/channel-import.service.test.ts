// ===========================================
// Channel Import Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelExportEntry } from '@mirthless/core-models';

// Mock database and dependencies
vi.mock('../../lib/db.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    transaction: vi.fn(async (fn) => fn({
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]) }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })),
  },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../partition-manager.service.js', () => ({
  PartitionManagerService: {
    createPartitions: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  },
}));

vi.mock('../../db/schema/index.js', () => ({
  channels: { id: 'id' },
  channelScripts: { channelId: 'channelId' },
  channelConnectors: { channelId: 'channelId' },
  channelMetadataColumns: { channelId: 'channelId' },
  channelFilters: { channelId: 'channelId', id: 'id' },
  filterRules: { filterId: 'filterId' },
  channelTransformers: { channelId: 'channelId', id: 'id' },
  transformerSteps: { transformerId: 'transformerId' },
}));

import { ChannelImportService } from '../channel-import.service.js';

// ----- Helpers -----

function makeEntry(overrides?: Partial<ChannelExportEntry>): ChannelExportEntry {
  return {
    id: 'ch-import-001',
    name: 'Imported Channel',
    description: 'Test import',
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
    scripts: [{ scriptType: 'DEPLOY', script: '' }],
    destinations: [],
    metadataColumns: [],
    filters: [],
    transformers: [],
    ...overrides,
  };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- importChannels -----

describe('ChannelImportService.importChannels', () => {
  it('creates channels when no collision', async () => {
    const result = await ChannelImportService.importChannels(
      [makeEntry()],
      'SKIP',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(1);
      expect(result.value.skipped).toBe(0);
      expect(result.value.updated).toBe(0);
      expect(result.value.errors).toHaveLength(0);
    }
  });

  it('imports multiple channels', async () => {
    const entries = [
      makeEntry({ id: 'ch-1', name: 'Channel 1' }),
      makeEntry({ id: 'ch-2', name: 'Channel 2' }),
    ];

    const result = await ChannelImportService.importChannels(entries, 'SKIP');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(2);
    }
  });

  it('returns import result with counts', async () => {
    const result = await ChannelImportService.importChannels([], 'SKIP');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
      });
    }
  });

  it('handles empty entries array', async () => {
    const result = await ChannelImportService.importChannels([], 'OVERWRITE');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(0);
      expect(result.value.updated).toBe(0);
      expect(result.value.skipped).toBe(0);
    }
  });

  it('includes channel names in context', async () => {
    const entry = makeEntry({ name: 'My Channel' });
    const result = await ChannelImportService.importChannels([entry], 'SKIP');
    expect(result.ok).toBe(true);
  });
});
