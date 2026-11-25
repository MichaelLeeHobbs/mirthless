import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import type { RawMessage, DispatchResult } from '../../base.js';
import { DISPATCH_STATUS } from '../../base.js';
import { KafkaReceiver, toRawMessage, type KafkaReceiverConfig } from '../kafka-receiver.js';
import { FakeKafkaTopic } from '../../__fixtures__/fake-kafka.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

const config: KafkaReceiverConfig = {
  brokers: 'kafka:9092',
  clientId: 'galvanigraph',
  saslMechanism: 'NONE',
  saslUsername: '',
  saslPassword: '',
  topic: 'adt',
  groupId: 'galvanigraph-adt',
  startFrom: 'EARLIEST',
};

type Dispatch = (raw: RawMessage) => Promise<Result<DispatchResult>>;

const stored = (messageId: number, status?: DispatchResult['status']): Result<DispatchResult> =>
  ({ ok: true, value: { messageId, status }, error: null });
const notStored = (message: string): Result<DispatchResult> =>
  ({ ok: false, value: null, error: new Error(message) } as unknown as Result<DispatchResult>);

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

/** Started on a topic with a record, whose dispatch is held until it is let go. */
async function startHeld(topic: FakeKafkaTopic, recoverable = true): Promise<{
  readonly log: ReturnType<typeof makeMockLogger>;
  readonly held: { readonly offered: string[]; readonly letGo: (result: Result<DispatchResult>) => void };
}> {
  const offered: string[] = [];
  let letGo = (result: Result<DispatchResult>): void => { void result; };
  const answer = new Promise<Result<DispatchResult>>((resolve) => { letGo = resolve; });
  const { log } = await start(topic, async (raw) => {
    offered.push(raw.content);
    raw.onStored?.({ recoverable });
    return answer;
  });
  await vi.waitFor(() => { expect(offered).toHaveLength(1); });
  return { log, held: { offered, letGo: (result) => { letGo(result); } } };
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

  it('counts a record that cannot be converted toward the cap, instead of rejoining forever', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const p = pipeline();
    const fatal: Error[] = [];
    const log = makeMockLogger();
    const subscribe: typeof topic.subscribe = async (c) => {
      const sub = await topic.subscribe(c);
      return {
        close: (force: boolean) => sub.close(force),
        async *[Symbol.asyncIterator]() {
          for await (const record of sub) {
            yield Object.defineProperty({ ...record }, 'value', { get: () => { throw new RangeError('decoder unavailable'); } });
          }
        },
      };
    };
    receiver = new KafkaReceiver({ ...config, maxStoreAttempts: 2 }, subscribe, log.logger, 5);
    receiver.setDispatcher(p.dispatch);
    receiver.setFatalHandler((error) => { fatal.push(error); });
    await receiver.onStart();
    await vi.waitFor(() => { expect(fatal).toHaveLength(1); });
    expect(fatal[0]?.message).toContain('decoder unavailable');
    expect(p.offered).toEqual([]);
    expect(topic.committed).toBe(0);
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
    const starting = receiver.onStart();
    releaseFirst?.();
    await starting;
    // Not stored, so it is read again.
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });
    expect(calls).toBe(2);
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

    fail = false;
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

    topic.failSubscribes = 2;
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

  it('a stop waits for the record in progress however long it takes, and reads none after it (#413)', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    topic.produce('MSH|2');
    const { held } = await startHeld(topic);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let stopped = false;
      const stopping = receiver?.onStop().then(() => { stopped = true; });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(stopped).toBe(false);
      held.letGo(stored(1));
      await stopping;
    } finally {
      vi.useRealTimers();
    }
    expect(topic.committed).toBe(1);
    expect(topic.isSubscribed).toBe(false);
    expect(held.offered).toEqual(['MSH|1']);
    receiver = null;
  });

  it('a halt does not wait, and a record recorded by then is committed, not read again (#413)', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    topic.produce('MSH|2');
    const { held } = await startHeld(topic);

    expect((await receiver?.onHalt())?.ok).toBe(true);
    expect(topic.committed).toBe(0);
    held.letGo(stored(1));
    await vi.waitFor(() => { expect(topic.isSubscribed).toBe(false); });

    expect(topic.committed).toBe(1);
    expect(held.offered).toEqual(['MSH|1']);
    receiver = null;
  });

  it.each([
    ['is committed when the channel keeps its content', true, 1],
    ['is read again when the channel does not', false, 0],
  ])('a record that a halt ended with an error %s', async (_what, recoverable, committed) => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const { held } = await startHeld(topic, recoverable);

    await receiver?.onHalt();
    held.letGo(stored(1, DISPATCH_STATUS.ERROR));
    await vi.waitFor(() => { expect(topic.isSubscribed).toBe(false); });

    expect(topic.committed).toBe(committed);
    receiver = null;
  });

  it.each(['onStop', 'onHalt', 'onUndeploy'] as const)('a start that an %s overtakes while it joins takes nothing and leaves the group', async (action) => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    let connected = (): void => undefined;
    topic.connecting = new Promise((resolve) => { connected = resolve; });
    const p = pipeline();
    receiver = new KafkaReceiver(config, topic.subscribe, makeMockLogger().logger, 5);
    receiver.setDispatcher(p.dispatch);

    const starting = receiver.onStart();
    await vi.waitFor(() => { expect(topic.subscribeCount).toBe(1); });
    await receiver[action]();
    connected();

    expect((await starting).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(p.offered).toEqual([]);
    expect(topic.isSubscribed).toBe(false);
    receiver = null;
  });

  it('a start that an undeploy overtakes while it waits for a record joins no group', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const { held } = await startHeld(topic);
    await receiver?.onHalt();

    const starting = receiver?.onStart();
    const undeploying = receiver?.onUndeploy();
    held.letGo(stored(1));
    await undeploying;

    expect((await starting)?.ok).toBe(false);
    expect(topic.subscribeCount).toBe(1);
    receiver = null;
  });

  it('a record whose destination the halt failed behind an early answer is read again when the channel does not keep its content', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const { held } = await startHeld(topic, false);

    await receiver?.onHalt();
    held.letGo({ ok: true, value: { messageId: 1, destinationFailed: true }, error: null });
    await vi.waitFor(() => { expect(topic.isSubscribed).toBe(false); });

    expect(topic.committed).toBe(0);
    receiver = null;
  });

  it('a halt ends a stop that waits', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const { held } = await startHeld(topic);

    const stopping = receiver?.onStop();
    await receiver?.onHalt();
    expect((await stopping)?.ok).toBe(true);
    held.letGo(stored(1));
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });
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
      if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return stored(calls);
    };
    await start(topic, dispatch);
    await vi.waitFor(() => { expect(calls).toBe(1); });
    await receiver?.onHalt();
    const starting = receiver?.onStart();
    releaseFirst?.();
    expect((await starting)?.ok).toBe(true);
    topic.produce('MSH|2');
    await vi.waitFor(() => { expect(topic.committed).toBe(2); });
    await new Promise((r) => setTimeout(r, 20));
    expect(offered).toEqual(['MSH|1', 'MSH|2']);
  });

  it('a start waits 10 seconds for the record a halt left in hand, and then reads it again', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const { log, held } = await startHeld(topic);
    await receiver?.onHalt();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let started = false;
      const starting = receiver?.onStart().then(() => { started = true; });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(started).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await starting;
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => { expect(held.offered).toEqual(['MSH|1', 'MSH|1']); });
    expect(log.warnings.some((w) => w.msg.includes('may be read again'))).toBe(true);
    held.letGo(stored(1));
    await vi.waitFor(() => { expect(topic.committed).toBe(1); });
  });

  it('an undeploy waits for the record a halt left in hand, which another deployment would read', async () => {
    const topic = new FakeKafkaTopic();
    topic.produce('MSH|1');
    const { held } = await startHeld(topic);
    await receiver?.onHalt();

    const undeploying = receiver?.onUndeploy();
    held.letGo(stored(1));
    await undeploying;

    expect(topic.committed).toBe(1);
    receiver = null;
  });
});

describe('a partner that does not answer (#413)', () => {
  it.each([
    ['halt', 'onHalt', 2_000],
    ['stop', 'onStop', 12_000],
  ] as const)('a %s ends although the broker never answers the close', async (_what, action, withinMs) => {
    const topic = new FakeKafkaTopic();
    topic.hangCloses = true;
    await start(topic, pipeline().dispatch);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const ending = receiver?.[action]();
      await vi.advanceTimersByTimeAsync(withinMs);
      expect((await ending)?.ok).toBe(true);
    } finally {
      vi.useRealTimers();
      receiver = null;
    }
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

  it('keeps a header named __proto__', () => {
    const record = new FakeKafkaTopic();
    record.produce('MSH|1');
    const raw = toRawMessage({
      ...record.record(0),
      headers: new Map([[Buffer.from('__proto__'), Buffer.from('x')], [Buffer.from('site'), Buffer.from('north')]]),
    });
    expect(JSON.stringify(raw.sourceMap['headers'])).toBe('{"__proto__":"x","site":"north"}');
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
