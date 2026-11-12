// ===========================================
// Destination template tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import { renderDestinationTemplate } from '../destination-template.js';
import { MessageProcessor } from '../message-processor.js';
import type { MessageStore, PipelineConfig } from '../message-processor.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';

const message = { encoded: 'ENCODED', raw: 'RAW', messageId: 42 };

describe('renderDestinationTemplate', () => {
  it('fills the message, its id and map variables from the first map that has them', () => {
    expect(renderDestinationTemplate('${message.encodedData}|${message.rawData}|${messageId}|${a}|${b}', message, [{ a: 'first' }, { a: 'second', b: { x: 1 } }]))
      .toBe('ENCODED|RAW|42|first|{"x":1}');
  });

  it('leaves a reference nothing defines as written', () => {
    expect(renderDestinationTemplate('to ${nowhere}', message, [{ nowhere: null }])).toBe('to ${nowhere}');
  });
});

describe('a destination with a template', () => {
  function ok<T>(value: T): Result<T> {
    return { ok: true, value, error: null } as Result<T>;
  }
  const store = (): MessageStore => ({
    createMessage: vi.fn().mockResolvedValue(ok({ messageId: 9, correlationId: '00000000-0000-0000-0000-000000000099' })),
    createConnectorMessage: vi.fn().mockResolvedValue(ok(undefined)),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue(ok(undefined)),
    storeContent: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    enqueue: vi.fn().mockResolvedValue(ok(undefined)),
    loadContent: vi.fn().mockResolvedValue(ok(null)),
    incrementStats: vi.fn().mockResolvedValue(ok(undefined)),
    dequeue: vi.fn().mockResolvedValue(ok([])),
    release: vi.fn().mockResolvedValue(ok(undefined)),
  });

  it('stores and sends the filled template, not the transformed message', async () => {
    const s = store();
    const send = vi.fn().mockResolvedValue(ok({ status: 'SENT', content: '' }));
    const config: PipelineConfig = {
      channelId: '00000000-0000-0000-0000-000000000011', serverId: 'server-01', dataType: 'RAW',
      scripts: { sourceTransformer: { code: '$c("oru", "MSH|ORU for " + msg);' } },
      configMap: { 'vns.SITE': 'NORTH' },
      destinations: [{ metaDataId: 1, name: 'Sender', enabled: true, scripts: {}, queueMode: 'NEVER', template: '${oru} at ${vns.SITE}' }],
    };
    const processor = new MessageProcessor(new VmSandboxExecutor(), s, send, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage({ rawContent: 'ACC1', sourceMap: {} }, AbortSignal.timeout(5_000));

    expect(send).toHaveBeenCalledWith(1, 9, 'MSH|ORU for ACC1 at NORTH', expect.any(AbortSignal), expect.any(String));
    expect(s.storeContent).toHaveBeenCalledWith(config.channelId, 9, 1, 5, 'MSH|ORU for ACC1 at NORTH', 'RAW');
  });
});
