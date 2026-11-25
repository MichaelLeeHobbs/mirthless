import { describe, it, expect, vi } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { MessageProcessor } from '../message-processor.js';
import type { MessageStore, PipelineInput, ProcessedMessage } from '../message-processor.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';

const CHANNEL = '00000000-0000-0000-0000-000000000012';
const CORRELATION = '00000000-0000-0000-0000-000000000099';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

/** Runs a message through a channel with one destination; what happened, in order. */
async function run(input: Partial<PipelineInput>, storing: Result<unknown> = ok({ messageId: 3, correlationId: CORRELATION })): Promise<{ order: string[]; result: Result<ProcessedMessage> }> {
  const order: string[] = [];
  const done = vi.fn().mockResolvedValue(ok(undefined));
  const store: MessageStore = {
    createMessage: vi.fn(),
    initializeMessage: vi.fn(async () => { order.push('storing'); return storing as Result<{ messageId: number; correlationId: string }>; }),
    createConnectorMessage: done,
    updateConnectorMessageStatus: done,
    storeContent: done,
    markProcessed: done,
    enqueue: done,
    loadContent: vi.fn().mockResolvedValue(ok(null)),
    incrementStats: done,
    dequeue: vi.fn().mockResolvedValue(ok([])),
    release: done,
  };
  const send = vi.fn(async () => { order.push('sent'); return ok({ status: 'SENT' as const, content: '' }); });
  const config = {
    channelId: CHANNEL, serverId: 'server-01', dataType: 'RAW', scripts: {},
    destinations: [{ metaDataId: 1, name: 'Partner', enabled: true, scripts: {}, queueMode: 'NEVER' as const }],
  };
  const result = await new MessageProcessor(new VmSandboxExecutor(), store, send, config, DEFAULT_EXECUTION_OPTIONS)
    .processMessage({ rawContent: 'x', sourceMap: {}, onStored: () => { order.push('onStored'); }, ...input }, AbortSignal.timeout(5_000));
  return { order, result };
}

describe('onStored', () => {
  it('is called once, after the message is stored and before anything is sent', async () => {
    const { order } = await run({});
    expect(order).toEqual(['storing', 'onStored', 'sent']);
  });

  it('is not called when the message could not be stored', async () => {
    const { order, result } = await run({}, { ok: false, value: null, error: new Error('down') } as unknown as Result<unknown>);
    expect(result.ok).toBe(false);
    expect(order).toEqual(['storing']);
  });
});
