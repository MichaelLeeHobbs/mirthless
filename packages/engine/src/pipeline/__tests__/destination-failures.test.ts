// ===========================================
// Destination failure records and variables
// ===========================================
// A failed send keeps its reason (whether the destination ends ERROR or waits
// in the queue), and a queued destination keeps the variables it will send with.

import { describe, it, expect, vi } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import { MessageProcessor } from '../message-processor.js';
import type { MessageStore, PipelineConfig, SendToDestination } from '../message-processor.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';

const CHANNEL = '00000000-0000-0000-0000-000000000012';
const CT_CHANNEL_MAP = 10;
const CT_ERROR = 11;
const CT_RESPONSE = 6;

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function makeStore(): MessageStore {
  return {
    createMessage: vi.fn().mockResolvedValue(ok({ messageId: 3, correlationId: '00000000-0000-0000-0000-000000000099' })),
    createConnectorMessage: vi.fn().mockResolvedValue(ok(undefined)),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue(ok(undefined)),
    storeContent: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    enqueue: vi.fn().mockResolvedValue(ok(undefined)),
    loadContent: vi.fn().mockResolvedValue(ok(null)),
    incrementStats: vi.fn().mockResolvedValue(ok(undefined)),
    dequeue: vi.fn().mockResolvedValue(ok([])),
    release: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

async function run(queueMode: 'NEVER' | 'ON_FAILURE' | 'ALWAYS', send: SendToDestination, transformer = '$c("mrn", "MRN1");'): Promise<MessageStore> {
  const store = makeStore();
  const config: PipelineConfig = {
    channelId: CHANNEL, serverId: 'server-01', dataType: 'RAW',
    scripts: { sourceTransformer: { code: transformer } },
    destinations: [{ metaDataId: 1, name: 'Partner', enabled: true, scripts: {}, queueMode }],
  };
  await new MessageProcessor(new VmSandboxExecutor(), store, send, config, DEFAULT_EXECUTION_OPTIONS)
    .processMessage({ rawContent: 'x', sourceMap: { remoteAddress: '10.0.0.1' } }, AbortSignal.timeout(5_000));
  return store;
}

const failing: SendToDestination = vi.fn().mockResolvedValue({ ok: false, value: null, error: new Error('connect ECONNREFUSED') });
const refusing: SendToDestination = vi.fn().mockResolvedValue(ok({ status: 'ERROR', content: 'MSA|AE|1', errorMessage: 'partner answered AE' }));

describe('a failed send keeps its reason', () => {
  it('when the destination ends ERROR', async () => {
    const store = await run('NEVER', failing);
    expect(store.storeContent).toHaveBeenCalledWith(CHANNEL, 3, 1, CT_ERROR, 'connect ECONNREFUSED', 'TEXT');
    expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL, 3, 1, 'ERROR');
  });

  it('when the destination waits in the queue', async () => {
    const store = await run('ON_FAILURE', failing);
    expect(store.storeContent).toHaveBeenCalledWith(CHANNEL, 3, 1, CT_ERROR, 'connect ECONNREFUSED', 'TEXT');
    expect(store.enqueue).toHaveBeenCalled();
  });

  it('with what the destination answered when it refused', async () => {
    const store = await run('NEVER', refusing);
    expect(store.storeContent).toHaveBeenCalledWith(CHANNEL, 3, 1, CT_ERROR, 'partner answered AE', 'TEXT');
    expect(store.storeContent).toHaveBeenCalledWith(CHANNEL, 3, 1, CT_RESPONSE, 'MSA|AE|1', 'TEXT');
  });
});

describe('the variables a destination sends with', () => {
  it('are passed to the send, without the source map', async () => {
    const send = vi.fn().mockResolvedValue(ok({ status: 'SENT', content: '' }));
    await run('NEVER', send);
    expect(send).toHaveBeenCalledWith(1, 3, 'x', expect.any(AbortSignal), expect.any(String), { mrn: 'MRN1' });
  });

  it('are stored for a queued destination', async () => {
    const store = await run('ALWAYS', vi.fn());
    expect(store.storeContent).toHaveBeenCalledWith(CHANNEL, 3, 1, CT_CHANNEL_MAP, '{"mrn":"MRN1"}', 'JSON');
  });

  it('are not stored for a destination that never queues, or when there are none', async () => {
    const sent = vi.fn().mockResolvedValue(ok({ status: 'SENT', content: '' }));
    const never = await run('NEVER', sent);
    const empty = await run('ALWAYS', vi.fn(), 'msg = msg;');
    for (const store of [never, empty]) {
      expect(store.storeContent).not.toHaveBeenCalledWith(CHANNEL, 3, 1, CT_CHANNEL_MAP, expect.anything(), 'JSON');
    }
  });
});
