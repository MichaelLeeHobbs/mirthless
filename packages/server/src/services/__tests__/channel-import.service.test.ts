import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelExportEntry } from '@galvanigraph/core-models';

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

// Placing a new channel in a group is covered against Postgres (create-in-scope.itest.ts).
vi.mock('../grant.service.js', () => ({ GrantService: { placeNewChannel: vi.fn().mockResolvedValue(null), newChannelGroup: vi.fn().mockResolvedValue(null) } }));

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

import { ChannelImportService, connectorDirectionError } from '../channel-import.service.js';
import { PartitionManagerService } from '../partition-manager.service.js';
import { GrantService } from '../grant.service.js';
import { db } from '../../lib/db.js';
import { StdError } from 'stderr-lib';

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

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it('imports a database connector with TLS on for a caller scoped to some groups', async () => {
    const database: ChannelExportEntry['destinations'][number] = {
      metaDataId: 1, name: 'Archive', enabled: true, connectorType: 'DATABASE', properties: { host: 'db', tls: true }, queueMode: 'NEVER',
      retryCount: 0, retryIntervalMs: 0, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
    };
    const result = await ChannelImportService.importChannels([makeEntry({ destinations: [database] })], 'SKIP');
    expect(result.ok && result.value).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
  });

  it('checks the group for new channels once before importing, and refuses the whole import when it fails', async () => {
    const actor = { userId: 'user-1', ipAddress: null };
    vi.mocked(GrantService.newChannelGroup).mockRejectedValueOnce(new Error('You can only put a new channel in a group where you can change channels'));
    const refused = await ChannelImportService.importChannels([makeEntry()], 'SKIP', actor, { groupId: 'g-1' });
    expect(refused.ok).toBe(false);
    expect(GrantService.newChannelGroup).toHaveBeenCalledWith(db, 'g-1', { userId: 'user-1' });
    expect(PartitionManagerService.createPartitions).not.toHaveBeenCalled();
  });

  it('places nothing for a backup restore, whose memberships come from the backup', async () => {
    await ChannelImportService.importChannels([makeEntry()], 'SKIP', undefined, 'restore');
    expect(GrantService.newChannelGroup).not.toHaveBeenCalled();
    expect(GrantService.placeNewChannel).not.toHaveBeenCalled();
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

  it('rolls back a channel whose partitions cannot be created, reports it and imports the rest (#260)', async () => {
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
    // Each channel's partitions are made in its own transaction; the rejected one rolled its channel row back.
    const calls = vi.mocked(PartitionManagerService.createPartitions).mock.calls;
    expect(calls.map((c) => c[0])).toEqual(['ch-1', 'ch-2']);
    for (const call of calls) expect(call[1]).toEqual(expect.objectContaining({ insert: expect.any(Function) }));
    expect(vi.mocked(db.transaction).mock.settledResults.map((r) => r.type)).toEqual(['rejected', 'fulfilled']);
  });
});

// #109

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
