// ===========================================
// Custom metadata column tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import { MessageProcessor, metadataValues } from '../message-processor.js';
import type { MessageStore, PipelineConfig } from '../message-processor.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function makeStore(): MessageStore & { storeCustomMetadata: ReturnType<typeof vi.fn> } {
  return {
    createMessage: vi.fn().mockResolvedValue(ok({ messageId: 7, correlationId: '00000000-0000-0000-0000-000000000099' })),
    createConnectorMessage: vi.fn().mockResolvedValue(ok(undefined)),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue(ok(undefined)),
    storeContent: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    enqueue: vi.fn().mockResolvedValue(ok(undefined)),
    loadContent: vi.fn().mockResolvedValue(ok(null)),
    incrementStats: vi.fn().mockResolvedValue(ok(undefined)),
    dequeue: vi.fn().mockResolvedValue(ok([])),
    release: vi.fn().mockResolvedValue(ok(undefined)),
    storeCustomMetadata: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

const config = (overrides: Partial<PipelineConfig>): PipelineConfig => ({
  channelId: '00000000-0000-0000-0000-000000000010',
  serverId: 'server-01',
  dataType: 'RAW',
  scripts: {},
  destinations: [{ metaDataId: 1, name: 'Dest', enabled: true, scripts: {}, queueMode: 'NEVER' }],
  ...overrides,
});

describe('metadataValues', () => {
  const columns = [
    { name: 'ACCESSION', dataType: 'STRING', mapping: 'accession' },
    { name: 'COUNT', dataType: 'NUMBER', mapping: 'count' },
    { name: 'STAT', dataType: 'BOOLEAN', mapping: 'stat' },
    { name: 'MISSING', dataType: 'STRING', mapping: 'nothing' },
  ];

  it('reads each column from the first map that has the variable and converts it to the column type', () => {
    expect(metadataValues(columns, [{ accession: 'A1' }, { accession: 'IGNORED', count: '3', stat: 'TRUE' }]))
      .toEqual({ ACCESSION: 'A1', COUNT: 3, STAT: true });
  });

  it('leaves out a NUMBER column whose value is not a number', () => {
    expect(metadataValues(columns, [{ count: 'many' }])).toEqual({});
  });

  it('skips null values and falls through to the next map', () => {
    expect(metadataValues(columns, [{ accession: null }, { accession: 'A2' }])).toEqual({ ACCESSION: 'A2' });
  });
});

describe('the pipeline stores metadata columns', () => {
  it('stores the source values a transformer put in the channel map', async () => {
    const store = makeStore();
    const processor = new MessageProcessor(new VmSandboxExecutor(), store, vi.fn().mockResolvedValue(ok({ status: 'SENT', content: '' })), config({
      scripts: { sourceTransformer: { code: 'channelMap["accession"] = "ACC-9"; $c("site", "NORTH");' } },
      metadataColumns: [
        { name: 'ACCESSION', dataType: 'STRING', mapping: 'accession' },
        { name: 'SITE', dataType: 'STRING', mapping: 'site' },
      ],
    }), DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000));

    expect(result.ok && result.value.status).toBe('SENT');
    expect(store.storeCustomMetadata).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 7, 0, { ACCESSION: 'ACC-9', SITE: 'NORTH' });
  });

  it('fails the message when its metadata cannot be stored', async () => {
    const store = makeStore();
    store.storeCustomMetadata.mockResolvedValue({ ok: false, value: null, error: new Error('db down') });
    const processor = new MessageProcessor(new VmSandboxExecutor(), store, vi.fn().mockResolvedValue(ok({ status: 'SENT', content: '' })), config({
      scripts: { sourceTransformer: { code: '$c("accession", "ACC-9");' } },
      metadataColumns: [{ name: 'ACCESSION', dataType: 'STRING', mapping: 'accession' }],
    }), DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000));

    expect(result.ok && result.value.status).toBe('ERROR');
  });

  it('stores nothing when no column has a value', async () => {
    const store = makeStore();
    const processor = new MessageProcessor(new VmSandboxExecutor(), store, vi.fn().mockResolvedValue(ok({ status: 'SENT', content: '' })), config({
      metadataColumns: [{ name: 'ACCESSION', dataType: 'STRING', mapping: 'accession' }],
    }), DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000));

    expect(store.storeCustomMetadata).not.toHaveBeenCalled();
  });
});
