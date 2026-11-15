// ===========================================
// Kafka Receiver Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import type { RawMessage, DispatchResult } from '../../base.js';
import { DISPATCH_STATUS } from '../../base.js';
import { KafkaReceiver, toRawMessage, type KafkaReceiverConfig } from '../kafka-receiver.js';
import { FakeKafkaTopic } from '../../__fixtures__/fake-kafka.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

const config: KafkaReceiverConfig = {
  brokers: 'kafka:9092',
  clientId: 'galvaniflow',
  saslMechanism: 'NONE',
  saslUsername: '',
  saslPassword: '',
  topic: 'adt',
  groupId: 'galvaniflow-adt',
  startFrom: 'EARLIEST',
};

type Dispatch = (raw: RawMessage) => Promise<Result<DispatchResult>>;

const stored = (messageId: number, status?: DispatchResult['status']): Result<DispatchResult> =>
  ({ ok: true, value: { messageId, status }, error: null });
const notStored = (message: string): Result<DispatchResult> =>
  ({ ok: false, value: null, error: new Error(message) } as unknown as Result<DispatchResult>);

/** A pipeline that records every message it is offered and answers with `answer`. */
function pipeline(answer: (raw: RawMessage, attempt: number) => Result<DispatchResult> = (_r, n) => stored(n)): { dispatch: Dispatch; offered: string[] } {
  const offered: string[] = [];
  return {
    offered,
    dispatch: async (raw) => {
      offered.push(raw.content);
      return answer(raw, offered.length);
    },
  };
}

let receiver: KafkaReceiver | null = null;
afterEach(async () => {
  await receiver?.onHalt();
  receiver = null;
});

async function start(topic: FakeKafkaTopic, dispatch: Dispatch, overrides: Partial<KafkaReceiverConfig> = {}) {
  const log = makeMockLogger();
  receiver = new KafkaReceiver({ ...config, ...overrides }, topic.subscribe, log.logger, 5);
  receiver.setDispatcher(dispatch);
  expect((await receiver.onDeploy()).ok).toBe(true);
  const started = await receiver.onStart();
  return { log, started };
}

describe('onDeploy', () => {
  it.each([
    [{ brokers: ' , ' }, 'broker'],
    [{ topic: '' }, 'Topic'],
    [{ groupId: '' }, 'Consumer group'],
  ])('rejects %o', async (overrides, text) => {
    const r = new KafkaReceiver({ ...config, ...overrides }, new FakeKafkaTopic().subscribe);
    const result = await r.onDeploy();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain(text);
  });
});

describe('onStart', () => {
  it('fails when no dispatcher is set', async () => {
    const r = new KafkaReceiver(config, new FakeKafkaTopic().subscribe);
    const result = await r.onStart();
    expect(result.ok).toBe(false);
  });

  it('fails when the broker cannot be reached', async () => {
    const topic = new FakeKafkaTopic();
    topic.failSubscribes = 1;
    const { started } = await start(topic, pipeline().dispatch);
    expect(started.ok).toBe(false);
    expect(started.error?.message).toContain('broker down');
  });
});

describe('consuming', () => {
  it('dispatches records in order and commits each after it is stored', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    topic.produce('MSH|2');
    const p = pipeline();
    await start(topic, p.dispatch);
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
    topic.produce('MSH|3');
    await vi.waitFor(() => { expect(topic.committed).toBe(3); });
    expect(p.offered).toEqual(['MSH|1', 'MSH|2', 'MSH|3']);
  });

  it('commits a record only after the pipeline answers', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await start(topic, async () => { await held; return stored(1); });
    await new Promise((r) => setTimeout(r, 20));
    expect(topic.committed).toBe(0);
    release?.();
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });
  });

  it('reads a record again when the pipeline did not store it, and keeps order', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    topic.produce('MSH|2');
    // The first attempt at MSH|1 fails to store (database down); later ones succeed.
    const p = pipeline((_raw, attempt) => (attempt === 1 ? notStored('database unavailable') : stored(attempt)));
    const { log } = await start(topic, p.dispatch);
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
    expect(p.offered).toEqual(['MSH|1', 'MSH|1', 'MSH|2']);
    expect(topic.subscribeCount).toBe(2);
    expect(log.errors.some((e) => e.msg.includes('will be read again'))).toBe(true);
  });

  it('commits a record stored with an ERROR status so it is not processed twice', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('bad');
    topic.produce('good');
    const p = pipeline((raw, n) => stored(n, raw.content === 'bad' ? DISPATCH_STATUS.ERROR : DISPATCH_STATUS.PROCESSED));
    const { log } = await start(topic, p.dispatch);
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
    expect(p.offered).toEqual(['bad', 'good']);
    expect(log.errors.some((e) => e.msg.includes('ERROR status'))).toBe(true);
  });

  it('logs a failed commit and carries on; the next commit covers the record', async () => {
    const topic = new FakeKafkaTopic();
    topic.failCommits = 1;
    topic.produce('MSH|1');
    topic.produce('MSH|2');
    const p = pipeline();
    const { log } = await start(topic, p.dispatch);
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
    expect(p.offered).toEqual(['MSH|1', 'MSH|2']);
    expect(log.errors.some((e) => e.msg.includes('commit failed'))).toBe(true);
  });
});

describe('a record the pipeline never stores', () => {
  it('stops retrying after the cap, reports a fatal error and does not commit', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|poison');
    topic.produce('MSH|next');
    const p = pipeline(() => notStored('invalid byte sequence for encoding "UTF8": 0x00'));
    const fatal: Error[] = [];
    const log = makeMockLogger();
    receiver = new KafkaReceiver({ ...config, maxStoreAttempts: 3 }, topic.subscribe, log.logger, 5);
    receiver.setDispatcher(p.dispatch);
    receiver.setFatalHandler((error) => { fatal.push(error); });
    await receiver.onStart();

    await vi.waitFor(() => { expect(fatal).toHaveLength(1); });
    await new Promise((r) => setTimeout(r, 30));
    expect(p.offered).toEqual(['MSH|poison', 'MSH|poison', 'MSH|poison']);
    expect(topic.committed).toBe(0);
    expect(topic.isSubscribed).toBe(false);
    expect(fatal[0]?.message).toContain('offset 0');
    expect(fatal[0]?.message).toContain('3 attempts');
    expect(log.errors.some((e) => e.msg.includes('Kafka source stopped'))).toBe(true);
  });

  it('defaults the cap to 5 attempts', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|poison');
    const p = pipeline(() => notStored('rejected'));
    let fatal = 0;
    await start(topic, p.dispatch);
    receiver?.setFatalHandler(() => { fatal += 1; });
    await vi.waitFor(() => { expect(fatal).toBe(1); });
    expect(p.offered).toHaveLength(5);
  });

  it('counts failures per record, so a transient failure that then succeeds starts the next record at zero', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    topic.produce('MSH|2');
    // Each record fails twice (database briefly down), then is stored: 4 failures in all, never 3 on one record.
    const failuresLeft = new Map([['MSH|1', 2], ['MSH|2', 2]]);
    const p = pipeline((raw, n) => {
      const left = failuresLeft.get(raw.content) ?? 0;
      failuresLeft.set(raw.content, left - 1);
      return left > 0 ? notStored('database unavailable') : stored(n);
    });
    let fatal = 0;
    const log = makeMockLogger();
    receiver = new KafkaReceiver({ ...config, maxStoreAttempts: 3 }, topic.subscribe, log.logger, 5);
    receiver.setDispatcher(p.dispatch);
    receiver.setFatalHandler(() => { fatal += 1; });
    await receiver.onStart();
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
    expect(fatal).toBe(0);
    expect(p.offered).toEqual(['MSH|1', 'MSH|1', 'MSH|1', 'MSH|2', 'MSH|2', 'MSH|2']);
  });

  it('does not report a fatal error for a failure that comes back during a stop', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    let fatal = 0;
    const log = makeMockLogger();
    receiver = new KafkaReceiver({ ...config, maxStoreAttempts: 1 }, topic.subscribe, log.logger, 5);
    receiver.setDispatcher(async () => { entered = true; await held; return notStored('database closed during shutdown'); });
    receiver.setFatalHandler(() => { fatal += 1; });
    await receiver.onStart();
    await vi.waitFor(() => { expect(entered).toBe(true); });

    const stopping = receiver.onStop();
    release?.();
    await stopping;
    await new Promise((r) => setTimeout(r, 20));
    expect(fatal).toBe(0);
    expect(topic.committed).toBe(0);
    receiver = null;
  });

  it('ignores a failed dispatch left over from before a halt and restart', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    let releaseFirst: (() => void) | undefined;
    let calls = 0;
    let fatal = 0;
    const log = makeMockLogger();
    receiver = new KafkaReceiver({ ...config, maxStoreAttempts: 1 }, topic.subscribe, log.logger, 5);
    receiver.setDispatcher(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return notStored('cancelled by the halt');
      }
      return stored(calls);
    });
    receiver.setFatalHandler(() => { fatal += 1; });
    await receiver.onStart();
    await vi.waitFor(() => { expect(calls).toBe(1); });
    await receiver.onHalt();
    await receiver.onStart();
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });

    releaseFirst?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(fatal).toBe(0);
    topic.produce('MSH|2');
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
  });

  it('gives a record a fresh count after the channel is started again', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|poison');
    let fail = true;
    const p = pipeline((_raw, n) => (fail ? notStored('rejected') : stored(n)));
    let fatal = 0;
    const log = makeMockLogger();
    receiver = new KafkaReceiver({ ...config, maxStoreAttempts: 2 }, topic.subscribe, log.logger, 5);
    receiver.setDispatcher(p.dispatch);
    receiver.setFatalHandler(() => { fatal += 1; });
    await receiver.onStart();
    await vi.waitFor(() => { expect(fatal).toBe(1); });
    await receiver.onStop();

    fail = false; // the operator fixed the cause
    await receiver.onStart();
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });
    expect(p.offered).toEqual(['MSH|poison', 'MSH|poison', 'MSH|poison']);
  });
});

describe('broker disconnect', () => {
  it('rejoins after the connection drops and resumes from the committed offset', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const p = pipeline();
    const { log } = await start(topic, p.dispatch);
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });

    topic.failSubscribes = 2; // the broker stays down for two attempts
    topic.disconnect();
    topic.produce('MSH|2');
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });

    expect(p.offered).toEqual(['MSH|1', 'MSH|2']);
    expect(topic.subscribeCount).toBe(4);
    expect(log.errors.some((e) => e.msg.includes('rejoining'))).toBe(true);
  });

  it('rejoins when the stream ends while running', async () => {
    const topic = new FakeKafkaTopic();
    const p = pipeline();
    const { log } = await start(topic, p.dispatch);
    // Closing the subscription from outside ends the stream, as a rebalance away from every partition can.
    await (topic as unknown as { active: { close(f: boolean): Promise<void> } }).active.close(false);
    await vi.waitFor(() => { expect(topic.subscribeCount).toBe(2); });
    expect(log.warnings.some((w) => w.msg.includes('stream ended'))).toBe(true);
  });
});

describe('stop and halt', () => {
  it('lets the record in progress finish and commit before leaving', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    await start(topic, async () => { entered = true; await held; return stored(1); });
    await vi.waitFor(() => { expect(entered).toBe(true); });

    const stopping = receiver?.onStop();
    release?.();
    expect((await stopping)?.ok).toBe(true);
    expect(topic.committed).toBe(1);
    expect(topic.isSubscribed).toBe(false);
    receiver = null;
  });

  it('reads nothing after a stop', async () => {
    const topic = new FakeKafkaTopic();
    const p = pipeline();
    await start(topic, p.dispatch);
    await receiver?.onStop();
    topic.produce('late');
    await new Promise((r) => setTimeout(r, 20));
    expect(p.offered).toEqual([]);
    expect(topic.committed).toBe(0);
    receiver = null;
  });

  it('halt leaves without waiting; the record in progress is read again next time', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    let entered = false;
    await start(topic, async () => { entered = true; return new Promise<Result<DispatchResult>>(() => undefined); });
    await vi.waitFor(() => { expect(entered).toBe(true); });
    expect((await receiver?.onHalt())?.ok).toBe(true);
    expect(topic.committed).toBe(0);
    expect(topic.isSubscribed).toBe(false);
    receiver = null;
  });
});

describe('halt then start again', () => {
  it('reads each record once: the loop from before the halt does not keep reading', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    let releaseFirst: (() => void) | undefined;
    const offered: string[] = [];
    let calls = 0;
    const dispatch: Dispatch = async (raw) => {
      offered.push(raw.content);
      calls += 1;
      // The first dispatch hangs until after the restart, then answers.
      if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return stored(calls);
    };
    await start(topic, dispatch);
    await vi.waitFor(() => { expect(calls).toBe(1); });
    await receiver?.onHalt();
    expect((await receiver?.onStart())?.ok).toBe(true);
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });
    releaseFirst?.();
    topic.produce('MSH|2');
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
    await new Promise((r) => setTimeout(r, 20));
    expect(offered).toEqual(['MSH|1', 'MSH|1', 'MSH|2']);
  });
});

describe('toRawMessage', () => {
  it('maps value, key, headers and position into the source map', () => {
    const topic = new FakeKafkaTopic('orders');
    topic.produce('MSH|1', 'patient-42', { traceId: 'abc', site: 'north' });
    const raw = toRawMessage(topic.record(0));
    expect(raw.content).toBe('MSH|1');
    expect(raw.sourceMap).toEqual({
      topic: 'orders',
      partition: 0,
      offset: '0',
      key: 'patient-42',
      headers: { traceId: 'abc', site: 'north' },
      timestamp: 1_700_000_000_000,
    });
  });

  it('gives a record with no key a null key', () => {
    const topic = new FakeKafkaTopic();
    topic.produce('x');
    expect(toRawMessage(topic.record(0)).sourceMap['key']).toBeNull();
  });

  it('gives a record with no value (a tombstone) empty content', () => {
    const topic = new FakeKafkaTopic();
    topic.produce('ignored', 'k');
    expect(toRawMessage({ ...topic.record(0), value: undefined }).content).toBe('');
  });

  it('decodes a Latin-1 payload when the charset is latin1', () => {
    const topic = new FakeKafkaTopic();
    topic.produce('x');
    // "PID|José" in ISO-8859-1: é is the single byte 0xE9, which is not valid UTF-8.
    const value = Buffer.from([...Buffer.from('PID|Jos'), 0xe9]);
    const raw = toRawMessage({ ...topic.record(0), value }, 'latin1');
    expect(raw.content).toBe('PID|José');
    expect(raw.sourceMap['charsetError']).toBeUndefined();
  });

  it('keeps a binary payload intact as base64 when the charset is base64', () => {
    const topic = new FakeKafkaTopic();
    topic.produce('x');
    const value = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0x0a]);
    const raw = toRawMessage({ ...topic.record(0), value }, 'base64');
    expect(Buffer.from(raw.content, 'base64').equals(value)).toBe(true);
  });

  it('flags a payload that is not valid UTF-8 instead of storing it as if nothing happened', () => {
    const topic = new FakeKafkaTopic();
    topic.produce('x');
    const raw = toRawMessage({ ...topic.record(0), value: Buffer.from([0x41, 0xe9, 0x42]) });
    expect(raw.content).toBe('A�B');
    expect(raw.sourceMap['charsetError']).toContain('not valid UTF-8');
  });
});

describe('charset', () => {
  it('logs a warning, without the payload, for a record that is not valid UTF-8, and still stores it', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('x');
    const p = pipeline();
    const log = makeMockLogger();
    // The fake produces text, so swap in bytes that are not valid UTF-8.
    const subscribe: typeof topic.subscribe = async (c) => {
      const sub = await topic.subscribe(c);
      return {
        close: (force: boolean) => sub.close(force),
        async *[Symbol.asyncIterator]() {
          for await (const record of sub) yield { ...record, value: Buffer.from([0x50, 0xe9]) };
        },
      };
    };
    receiver = new KafkaReceiver(config, subscribe, log.logger, 5);
    receiver.setDispatcher(p.dispatch);
    await receiver.onStart();
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });
    const warning = log.warnings.find((w) => w.msg.includes('not valid UTF-8'));
    expect(warning).toBeDefined();
    expect(JSON.stringify(warning)).not.toContain('P�');
  });
});
