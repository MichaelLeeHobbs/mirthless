// What scripts log is stored with the message they run for, and handed on for the server log (#164).

import { describe, it, expect, vi } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { MAX_SCRIPT_LOG_LINES, type ScriptLogRun } from '@galvanigraph/core-models';
import { MessageProcessor, type ChannelScripts, type DestinationConfig, type DestinationResponse, type MessageStore, type PipelineConfig, type StoreFailure } from '../message-processor.js';
import { DEFAULT_EXECUTION_OPTIONS, VmSandboxExecutor } from '../../sandbox/sandbox-executor.js';
import type { ScriptRunAt } from '../../sandbox/script-run-log.js';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

const log = (text: string, rest = ''): { readonly code: string } => ({ code: `logger.info(${JSON.stringify(text)}); ${rest}` });

/** A store that remembers the order of what it was asked. */
function makeStore(calls: string[], overrides: Partial<MessageStore> = {}): MessageStore {
  return {
    createMessage: async () => ok({ messageId: 7, correlationId: 'c' }),
    createConnectorMessage: async () => ok(undefined),
    updateConnectorMessageStatus: async (_c, _m, metaDataId, status) => { calls.push(`${String(metaDataId)} ${status}`); return ok(undefined); },
    storeContent: async () => ok(undefined),
    markProcessed: async () => { calls.push('processed'); return ok(undefined); },
    enqueue: async (_c, _m, metaDataId) => { calls.push(`${String(metaDataId)} queued`); return ok(undefined); },
    loadContent: async () => ok(null),
    incrementStats: async () => ok(undefined),
    dequeue: async () => ok([]),
    release: async () => ok(undefined),
    // Slow, so that what does not wait for it comes before it.
    storeScriptLog: async (_c, _m, metaDataId, run) => {
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      calls.push(`${String(metaDataId)} log ${run.script}: ${run.lines.map((l) => l.text).join(', ')}`);
      return ok(undefined);
    },
    ...overrides,
  };
}

function destination(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER', ...overrides };
}

async function run(
  scripts: ChannelScripts,
  options: { readonly destinations?: readonly DestinationConfig[]; readonly store?: Partial<MessageStore>; readonly response?: DestinationResponse; readonly config?: Partial<PipelineConfig> } = {},
): Promise<{ readonly calls: string[]; readonly status: string }> {
  const calls: string[] = [];
  const processor = new MessageProcessor(
    new VmSandboxExecutor(), makeStore(calls, options.store),
    vi.fn().mockResolvedValue(ok(options.response ?? { status: 'SENT', content: 'AA' })),
    { channelId: 'ch', serverId: 's', dataType: 'RAW', scripts, destinations: options.destinations ?? [], ...options.config },
    DEFAULT_EXECUTION_OPTIONS,
  );
  const result = await processor.processMessage({ rawContent: 'hello', sourceMap: {} }, AbortSignal.timeout(10_000));
  if (!result.ok) throw result.error;
  return { calls, status: result.value.status };
}

describe('the message', () => {
  it('has what each script logged, on the connector it ran for, before the status that follows', async () => {
    const { calls } = await run({
      globalPreprocessor: log('gpre', 'return msg;'),
      preprocessor: log('pre', 'return msg;'),
      sourceFilter: log('filter', 'return true;'),
      sourceTransformer: log('transformer', 'return msg;'),
      postprocessor: log('post'),
      globalPostprocessor: log('gpost'),
    }, {
      destinations: [destination({ scripts: { filter: log('dest filter', 'return true;'), transformer: log('dest transformer', 'return msg;'), responseTransformer: log('response', 'return msg;') } })],
    });

    expect(calls).toEqual([
      '0 log Global preprocessor: gpre',
      '0 log Preprocessor: pre',
      '0 log Source filter: filter',
      '0 log Source transformer: transformer',
      '0 TRANSFORMED',
      '1 log Destination filter: dest filter',
      '1 log Destination transformer: dest transformer',
      '1 log Response transformer: response',
      '1 SENT',
      '0 log Postprocessor: post',
      '0 log Global postprocessor: gpost',
      '0 SENT',
      'processed',
    ]);
  });

  it.each<[string, ChannelScripts, string[]]>([
    ['a filter that drops it', { sourceFilter: log('dropped', 'return false;') }, ['0 log Source filter: dropped', '0 FILTERED', 'processed']],
    ['a filter that throws', { sourceFilter: log('broken', 'throw new Error("x");') }, ['0 log Source filter: broken', '0 ERROR', 'processed']],
    ['a preprocessor that throws', { preprocessor: log('broken', 'throw new Error("x");') }, ['0 log Preprocessor: broken', '0 ERROR', 'processed']],
    ['a postprocessor that throws', { postprocessor: log('broken', 'throw new Error("x");') }, ['0 TRANSFORMED', '0 log Postprocessor: broken', '0 ERROR', 'processed']],
  ])('has what was logged by %s', async (_case, scripts, calls) => {
    expect((await run(scripts)).calls).toEqual(calls);
  });

  it.each<[string, Partial<DestinationConfig>, string[]]>([
    ['a destination filter that drops it', { scripts: { filter: log('dropped', 'return false;') } }, ['1 log Destination filter: dropped', '1 FILTERED']],
    ['a destination transformer that throws', { scripts: { transformer: log('broken', 'throw new Error("x");') } }, ['1 log Destination transformer: broken', '1 ERROR']],
    ['a response transformer that throws', { scripts: { responseTransformer: log('broken', 'throw new Error("x");') } }, ['1 log Response transformer: broken', '1 SENT']],
    ['a transformer before it is queued', { queueMode: 'ALWAYS', scripts: { transformer: log('queued', 'return msg;') } }, ['1 log Destination transformer: queued', '1 queued']],
  ])('has what was logged by %s', async (_case, dest, calls) => {
    expect((await run({}, { destinations: [destination(dest)] })).calls.filter((c) => c.startsWith('1 '))).toEqual(calls);
  });

  it('has nothing of scripts that log nothing', async () => {
    expect((await run({ sourceFilter: { code: 'return true;' } })).calls).toEqual(['0 TRANSFORMED', '0 SENT', 'processed']);
  });

  it('has the first lines of a run, and how many were left out', async () => {
    const runs: ScriptLogRun[] = [];
    await run({ sourceFilter: { code: 'for (let i = 0; i < 250; i++) logger.debug(i); return true;' } }, {
      store: { storeScriptLog: async (_c, _m, _d, r) => { runs.push(r); return ok(undefined); } },
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ script: 'Source filter', leftOut: 250 - MAX_SCRIPT_LOG_LINES });
    expect(runs[0]?.lines).toHaveLength(MAX_SCRIPT_LOG_LINES);
  });

  it('is processed all the same when a log cannot be stored, and that is reported', async () => {
    const failures: StoreFailure[] = [];
    const { status } = await run({ sourceFilter: log('x', 'return true;') }, {
      store: { storeScriptLog: async () => ({ ok: false, value: null, error: new Error('disk full') }) as unknown as Result<void> },
      config: { onStoreFailure: (failure) => { failures.push(failure); } },
    });

    expect(status).toBe('SENT');
    expect(failures).toEqual([{ channelId: 'ch', messageId: 7, metaDataId: 0, what: 'what a script logged', errorMessage: 'disk full' }]);
  });

  it('needs no store that keeps logs', async () => {
    expect((await run({ sourceFilter: log('x', 'return true;') }, { store: { storeScriptLog: undefined } as Partial<MessageStore> })).status).toBe('SENT');
  });
});

describe('the server log', () => {
  it('gets each line with the channel, message, connector and script, in order', async () => {
    const seen: [ScriptRunAt, string][] = [];
    await run({ sourceFilter: { code: 'logger.info("one"); logger.error("two"); return true;' } }, {
      destinations: [destination({ scripts: { transformer: { code: `for (let i = 0; i < ${String(MAX_SCRIPT_LOG_LINES + 3)}; i++) logger.warn("w"); return msg;` } } })],
      config: { scriptLog: (at) => ({ line: (l) => { seen.push([at, `${l.level} ${l.text}`]); }, leftOut: (count) => { seen.push([at, `left out ${String(count)}`]); } }) },
    });

    const source = { channelId: 'ch', messageId: 7, metaDataId: 0, script: 'Source filter' };
    const dest = { channelId: 'ch', messageId: 7, metaDataId: 1, script: 'Destination transformer' };
    expect(seen.slice(0, 3)).toEqual([[source, 'INFO one'], [source, 'ERROR two'], [dest, 'WARN w']]);
    expect(seen).toHaveLength(2 + MAX_SCRIPT_LOG_LINES + 1);
    expect(seen.at(-1)).toEqual([dest, 'left out 3']);
  });
});
