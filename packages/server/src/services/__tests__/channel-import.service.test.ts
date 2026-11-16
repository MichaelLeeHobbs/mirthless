// ===========================================
// Channel Import Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelExportEntry } from '@galvaniflow/core-models';

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

import { ChannelImportService, stripRedactedProperties, connectorDirectionError } from '../channel-import.service.js';
import { PartitionManagerService } from '../partition-manager.service.js';
import { db } from '../../lib/db.js';
import { StdError } from 'stderr-lib';

describe('stripRedactedProperties', () => {
  it('drops redacted credential values but keeps everything else', () => {
    const out = stripRedactedProperties({
      host: 'db.local', port: 5432, password: '__REDACTED__', apiKey: '__REDACTED__', username: 'svc',
    });
    expect(out).toEqual({ host: 'db.local', port: 5432, username: 'svc' });
    expect('password' in out).toBe(false);
    expect('apiKey' in out).toBe(false);
  });

  it('drops redacted values nested in objects and arrays', () => {
    const out = stripRedactedProperties({
      auth: { username: 'svc', password: '__REDACTED__' },
      tls: { cert: 'C', key: '__REDACTED__' },
      attachments: [{ filename: 'a', apiToken: '__REDACTED__' }, 'x'],
    });
    expect(out).toEqual({ auth: { username: 'svc' }, tls: { cert: 'C' }, attachments: [{ filename: 'a' }, 'x'] });
  });

  it('returns an empty object for null/non-object input', () => {
    expect(stripRedactedProperties(null)).toEqual({});
    expect(stripRedactedProperties(undefined)).toEqual({});
  });
});

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

  it('does not write a channel whose partitions cannot be created, and reports it (#260)', async () => {
    vi.mocked(PartitionManagerService.createPartitions)
      .mockResolvedValueOnce({ ok: false, value: null, error: new StdError('permission denied for table messages') });
    const entries = [makeEntry({ id: 'ch-1', name: 'No Partitions' }), makeEntry({ id: 'ch-2', name: 'Fine' })];

    const result = await ChannelImportService.importChannels(entries, 'SKIP');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(1);
    expect(result.value.errors).toEqual([
      'Error importing "No Partitions": its message partitions could not be created, so it was not imported: permission denied for table messages',
    ]);
    // Only the channel whose partitions exist was written.
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
    expect(vi.mocked(PartitionManagerService.createPartitions).mock.calls.map((c) => c[0])).toEqual(['ch-1', 'ch-2']);
  });
});

// ----- Connector direction (#109) -----

describe('ChannelImportService connector direction', () => {
  const destination = (name: string, connectorType: string): ChannelExportEntry['destinations'][number] =>
    ({ metaDataId: 1, name, enabled: true, connectorType, properties: {}, queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 0, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false }) as ChannelExportEntry['destinations'][number];

  it('reports a channel with a send-only source and still imports the rest of the file', async () => {
    const entries = [
      makeEntry({ id: 'ch-bad', name: 'Bad Source', sourceConnectorType: 'SMTP' }),
      makeEntry({ id: 'ch-good', name: 'Good Channel' }),
    ];

    const result = await ChannelImportService.importChannels(entries, 'SKIP');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(1);
    expect(result.value.errors).toEqual(['Channel "Bad Source": SMTP cannot be a source; not imported']);
  });

  it('names a destination that cannot send', () => {
    const entry = makeEntry({ name: 'Mailbox', destinations: [destination('To EHR', 'TCP_MLLP'), destination('Inbox', 'EMAIL')] });
    expect(connectorDirectionError(entry)).toBe('Channel "Mailbox": destination "Inbox" uses EMAIL, which cannot be a destination; not imported');
  });

  it('rejects a type that is not a connector at all', () => {
    expect(connectorDirectionError(makeEntry({ sourceConnectorType: 'FTP' }))).toMatch(/FTP cannot be a source/);
  });

  it('accepts connectors pointing the right way', () => {
    expect(connectorDirectionError(makeEntry({ sourceConnectorType: 'EMAIL', destinations: [destination('Mail', 'SMTP'), destination('FHIR', 'FHIR')] }))).toBeNull();
  });
});
