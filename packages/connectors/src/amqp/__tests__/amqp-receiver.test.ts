import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import type { RawMessage, DispatchResult } from '../../base.js';
import { DISPATCH_STATUS } from '../../base.js';
import { AmqpReceiver, toRawMessage, type AmqpReceiverConfig } from '../amqp-receiver.js';
import { headersToRecord } from '../amqp-client.js';
import { FakeAmqpQueue } from '../../__fixtures__/fake-amqp.js';
import { nestedTables, nestedTablesJson } from '../../__fixtures__/nested-headers.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

const config: AmqpReceiverConfig = { host: 'rabbit', port: 5672, vhost: '/', username: 'u', password: 'p', queue: 'adt' };

type Dispatch = (raw: RawMessage) => Promise<Result<DispatchResult>>;

const stored = (messageId: number, status?: DispatchResult['status']): Result<DispatchResult> =>
  ({ ok: true, value: { messageId, status }, error: null });
const notStored = (message: string): Result<DispatchResult> =>
  ({ ok: false, value: null, error: new Error(message) } as unknown as Result<DispatchResult>);

function pipeline(answer: (raw: RawMessage, attempt: number) => Result<DispatchResult> = (_r, n) => stored(n)): { dispatch: Dispatch; offered: RawMessage[] } {
  const offered: RawMessage[] = [];
  return {
    offered,
    dispatch: async (raw) => {
      offered.push(raw);
      return answer(raw, offered.length);
    },
  };
}

let receiver: AmqpReceiver | null = null;
afterEach(async () => {
  await receiver?.onHalt();
  receiver = null;
});

async function start(queue: FakeAmqpQueue, dispatch: Dispatch) {
  const log = makeMockLogger();
  receiver = new AmqpReceiver(config, queue.consume, log.logger, 5);
  receiver.setDispatcher(dispatch);
  expect((await receiver.onDeploy()).ok).toBe(true);
  const started = await receiver.onStart();
  return { log, started };
}

/** Started on a queue with a message, whose dispatch is held until it is let go. */
async function startHeld(queue: FakeAmqpQueue, recoverable = true): Promise<{
  readonly offered: string[];
  readonly letGo: (result: Result<DispatchResult>) => void;
}> {
  const offered: string[] = [];
  let letGo = (result: Result<DispatchResult>): void => { void result; };
  const answer = new Promise<Result<DispatchResult>>((resolve) => { letGo = resolve; });
  await start(queue, async (raw) => {
    offered.push(raw.content);
    raw.onStored?.({ recoverable });
    return answer;
  });
  await vi.waitFor(() => { expect(offered).toHaveLength(1); });
  return { offered, letGo: (result) => { letGo(result); } };
}

describe('onDeploy', () => {
  it.each([
    [{ host: '' }, 'Host'],
    [{ port: 0 }, 'Port'],
    [{ queue: '' }, 'Queue'],
  ])('rejects %o', async (overrides, text) => {
    const result = await new AmqpReceiver({ ...config, ...overrides }).onDeploy();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain(text);
  });
});

describe('onStart', () => {
  it('fails without a dispatcher', async () => {
    expect((await new AmqpReceiver(config, new FakeAmqpQueue().consume).onStart()).ok).toBe(false);
  });

  it('fails when the broker cannot be reached', async () => {
    const queue = new FakeAmqpQueue();
    queue.failConnects = 1;
    const { started } = await start(queue, pipeline().dispatch);
    expect(started.ok).toBe(false);
    expect(queue.connected).toBe(false);
  });
});

describe('consuming', () => {
  it('acknowledges each message after it is stored, in order', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    queue.publish('MSH|2');
    const p = pipeline();
    await start(queue, p.dispatch);
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1', 'MSH|2']); });
    expect(p.offered.map((r) => r.content)).toEqual(['MSH|1', 'MSH|2']);
  });

  it('does not acknowledge until the pipeline answers', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await start(queue, async () => { await held; return stored(1); });
    await new Promise((r) => setTimeout(r, 20));
    expect(queue.acked).toEqual([]);
    release?.();
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1']); });
  });

  it('returns a message the pipeline could not store to the queue and delivers it again first', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    queue.publish('MSH|2');
    const p = pipeline((_raw, attempt) => (attempt === 1 ? notStored('database unavailable') : stored(attempt)));
    const { log } = await start(queue, p.dispatch);
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1', 'MSH|2']); });
    expect(p.offered.map((r) => r.content)).toEqual(['MSH|1', 'MSH|1', 'MSH|2']);
    expect(p.offered[1]?.sourceMap['redelivered']).toBe(true);
    expect(log.errors.some((e) => e.msg.includes('returning it to the queue'))).toBe(true);
  });

  it('rejects a message stored with an ERROR status without requeue (dead-letter)', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('bad');
    queue.publish('good');
    const p = pipeline((raw, n) => stored(n, raw.content === 'bad' ? DISPATCH_STATUS.ERROR : DISPATCH_STATUS.FILTERED));
    await start(queue, p.dispatch);
    await vi.waitFor(() => { expect(queue.acked).toEqual(['good']); });
    expect(queue.deadLettered).toEqual(['bad']);
  });
});

describe('a message the pipeline never stores', () => {
  function startCapped(queue: FakeAmqpQueue, dispatch: Dispatch, maxStoreAttempts?: number) {
    const log = makeMockLogger();
    const fatal: Error[] = [];
    receiver = new AmqpReceiver(maxStoreAttempts === undefined ? config : { ...config, maxStoreAttempts }, queue.consume, log.logger, 5);
    receiver.setDispatcher(dispatch);
    receiver.setFatalHandler((error) => { fatal.push(error); });
    return { log, fatal, started: receiver.onStart() };
  }

  it('counts headers that cannot be converted toward the cap', async () => {
    const queue = new FakeAmqpQueue();
    const headers = { get site(): string { throw new Error('cannot convert this header'); } };
    queue.publish('MSH|poison', headers);
    const p = pipeline();
    const { fatal } = startCapped(queue, p.dispatch, 3);

    await vi.waitFor(() => { expect(fatal).toHaveLength(1); });
    expect(fatal[0]?.message).toContain('after 3 attempts (cannot convert this header)');
    expect(p.offered).toEqual([]);
    expect(queue.connectCount).toBe(1);
    await vi.waitFor(() => { expect(queue.messages.map((m) => m.body)).toEqual(['MSH|poison']); });
  });

  it('stops retrying after the cap, reports a fatal error, and neither acks nor dead-letters it', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|poison');
    queue.publish('MSH|next');
    const p = pipeline(() => notStored('invalid byte sequence for encoding "UTF8": 0x00'));
    const { log, fatal } = startCapped(queue, p.dispatch, 3);

    await vi.waitFor(() => { expect(fatal).toHaveLength(1); });
    await vi.waitFor(() => { expect(queue.connected).toBe(false); });
    await new Promise((r) => setTimeout(r, 30));
    expect(p.offered.map((r) => r.content)).toEqual(['MSH|poison', 'MSH|poison', 'MSH|poison']);
    expect(queue.acked).toEqual([]);
    expect(queue.deadLettered).toEqual([]);
    expect(queue.messages.map((m) => m.body)).toEqual(['MSH|poison', 'MSH|next']);
    expect(fatal[0]?.message).toContain('3 attempts');
    expect(log.errors.some((e) => e.msg.includes('AMQP source stopped'))).toBe(true);
  });

  it('defaults the cap to 5 attempts', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|poison');
    const p = pipeline(() => notStored('rejected'));
    const { fatal } = startCapped(queue, p.dispatch);
    await vi.waitFor(() => { expect(fatal).toHaveLength(1); });
    expect(p.offered).toHaveLength(5);
  });

  it('resets the count when a message is stored, so transient failures never add up to the cap', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    queue.publish('MSH|2');
    const failuresLeft = new Map([['MSH|1', 2], ['MSH|2', 2]]);
    const p = pipeline((raw, n) => {
      const left = failuresLeft.get(raw.content) ?? 0;
      failuresLeft.set(raw.content, left - 1);
      return left > 0 ? notStored('database unavailable') : stored(n);
    });
    const { fatal } = startCapped(queue, p.dispatch, 3);
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1', 'MSH|2']); });
    expect(fatal).toEqual([]);
  });

  it('counts per message id, so a queue that requeues at the tail still stops on the failing message', async () => {
    const queue = new FakeAmqpQueue();
    queue.requeueAtTail = true; // as a quorum queue may
    for (const body of ['bad', 'ok-1', 'ok-2', 'ok-3']) queue.publish(body);
    const p = pipeline((raw, n) => (raw.content === 'bad' ? notStored('rejected') : stored(n)));
    const withIds: typeof queue.consume = (c, onDelivery) =>
      queue.consume(c, (d) => { onDelivery({ ...d, messageId: d.content.toString() }); });
    const log = makeMockLogger();
    const fatal: Error[] = [];
    receiver = new AmqpReceiver({ ...config, maxStoreAttempts: 3 }, withIds, log.logger, 5);
    receiver.setDispatcher(p.dispatch);
    receiver.setFatalHandler((error) => { fatal.push(error); });
    await receiver.onStart();

    await vi.waitFor(() => { expect(fatal).toHaveLength(1); });
    // Three attempts on 'bad' in all. Counting failures in a row, the stored messages
    // between its first and second attempt would have reset the count and let it try a fourth time.
    expect(p.offered.map((r) => r.content)).toEqual(['bad', 'ok-1', 'ok-2', 'ok-3', 'bad', 'bad']);
    expect(queue.acked).toEqual(['ok-1', 'ok-2', 'ok-3']);
  });

  it('does not report a fatal error once the channel was restarted while the stop was closing the connection', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|poison');
    let releaseClose: (() => void) | undefined;
    let closing = false;
    let connections = 0;
    const slowFirstClose: typeof queue.consume = async (c, onDelivery) => {
      const consumer = await queue.consume(c, onDelivery);
      connections += 1;
      if (connections > 1) return consumer;
      return {
        closed: consumer.closed,
        close: async (timeoutMs) => {
          closing = true;
          await new Promise<void>((resolve) => { releaseClose = resolve; });
          await consumer.close(timeoutMs);
        },
      };
    };
    let calls = 0;
    const p = pipeline(() => { calls += 1; return calls === 1 ? notStored('rejected') : stored(calls); });
    const fatal: Error[] = [];
    receiver = new AmqpReceiver({ ...config, maxStoreAttempts: 1 }, slowFirstClose, makeMockLogger().logger, 5);
    receiver.setDispatcher(p.dispatch);
    receiver.setFatalHandler((error) => { fatal.push(error); });
    await receiver.onStart();
    await vi.waitFor(() => { expect(closing).toBe(true); });

    await receiver.onHalt();
    await receiver.onStart();
    releaseClose?.();
    await new Promise((r) => setTimeout(r, 30));
    expect(fatal).toEqual([]);
  });

  it('does not report a fatal error for a failure that comes back during a stop', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    const { fatal } = startCapped(queue, async () => { entered = true; await held; return notStored('database closed during shutdown'); }, 1);
    await vi.waitFor(() => { expect(entered).toBe(true); });

    const stopping = receiver?.onStop();
    release?.();
    await stopping;
    await new Promise((r) => setTimeout(r, 20));
    expect(fatal).toEqual([]);
    expect(queue.messages.map((m) => m.body)).toEqual(['MSH|1']);
    receiver = null;
  });

  it('ignores a failed dispatch left over from before a halt and restart', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let releaseFirst: (() => void) | undefined;
    let calls = 0;
    const { fatal } = startCapped(queue, async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return notStored('cancelled by the halt');
      }
      return stored(calls);
    }, 1);
    await vi.waitFor(() => { expect(calls).toBe(1); });
    await receiver?.onHalt();
    await receiver?.onStart();
    releaseFirst?.();
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1']); });
    await new Promise((r) => setTimeout(r, 20));
    expect(fatal).toEqual([]);
    queue.publish('MSH|2');
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1', 'MSH|2']); });
  });
});

describe('a delivery that throws', () => {
  it('returns a message whose dispatch throws to the queue and keeps consuming', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let calls = 0;
    const offered: string[] = [];
    const { log } = await start(queue, async (raw) => {
      offered.push(raw.content);
      calls += 1;
      if (calls === 1) throw new Error('dispatcher bug');
      return stored(calls);
    });
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1']); });
    queue.publish('MSH|2');
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1', 'MSH|2']); });
    expect(offered).toEqual(['MSH|1', 'MSH|1', 'MSH|2']);
    expect(JSON.stringify(log.errors)).not.toContain('MSH|1');
  });

  it('keeps consuming after converting a delivery throws', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let first = true;
    const throwingOnce: typeof queue.consume = (c, onDelivery) => queue.consume(c, (d) => {
      if (!first) { onDelivery(d); return; }
      first = false;
      onDelivery(Object.defineProperty({ ...d }, 'content', { get: () => { throw new RangeError('decoder unavailable'); } }));
    });
    const p = pipeline();
    receiver = new AmqpReceiver(config, throwingOnce, makeMockLogger().logger, 5);
    receiver.setDispatcher(p.dispatch);
    await receiver.onStart();
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1']); });
    queue.publish('MSH|2');
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1', 'MSH|2']); });
  });

  it('a start does not wait behind a dispatch that a halt left in hand, whose message stays with the broker', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    const offered: string[] = [];
    await start(queue, async (raw) => {
      offered.push(raw.content);
      if (offered.length === 1) return new Promise<Result<DispatchResult>>(() => undefined);
      return stored(offered.length);
    });
    await vi.waitFor(() => { expect(offered).toHaveLength(1); });
    await receiver?.onHalt();
    await receiver?.onStart();
    queue.publish('MSH|2');
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|2']); });
    expect(offered).toEqual(['MSH|1', 'MSH|2']);
  });
});

describe('broker disconnect', () => {
  it('reconnects after the connection drops, and the message that was in flight is delivered again', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let calls = 0;
    let dropped = false;
    const offered: RawMessage[] = [];
    const dispatch: Dispatch = async (raw) => {
      offered.push(raw);
      calls += 1;
      if (calls === 1) { queue.failConnects = 2; queue.disconnect(); dropped = true; }
      return stored(calls);
    };
    const { log } = await start(queue, dispatch);
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1']); });

    expect(dropped).toBe(true);
    expect(offered.map((r) => [r.content, r.sourceMap['redelivered']])).toEqual([['MSH|1', false], ['MSH|1', true]]);
    expect(queue.connectCount).toBe(4);
    expect(log.errors.some((e) => e.msg.includes('acknowledgement failed'))).toBe(true);
    expect(log.errors.some((e) => e.msg.includes('connection lost'))).toBe(true);

    queue.publish('MSH|2');
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1', 'MSH|2']); });
  });

  // A cancelled consumer (queue deleted) or a closed channel (consumer_timeout)
  // leaves its connection open; each reconnect used to leak one.
  it('closes the old connection when the broker cancels the consumer, then reconnects', async () => {
    const queue = new FakeAmqpQueue();
    await start(queue, pipeline().dispatch);
    queue.cancel();
    await vi.waitFor(() => { expect(queue.connectCount).toBe(2); });
    queue.cancel();
    await vi.waitFor(() => { expect(queue.connectCount).toBe(3); });
    expect(queue.openConnections).toBe(1);

    queue.publish('MSH|1');
    await vi.waitFor(() => { expect(queue.acked).toEqual(['MSH|1']); });
  });
});

describe('stop and halt', () => {
  it('stop lets the message in progress finish and be acknowledged', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let release: (() => void) | undefined;
    let entered = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await start(queue, async () => { entered = true; await held; return stored(1); });
    await vi.waitFor(() => { expect(entered).toBe(true); });
    const stopping = receiver?.onStop();
    release?.();
    expect((await stopping)?.ok).toBe(true);
    expect(queue.acked).toEqual(['MSH|1']);
    expect(queue.connected).toBe(false);
    receiver = null;
  });

  it('stop during the pause before a requeue returns the message at once', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    const log = makeMockLogger();
    receiver = new AmqpReceiver(config, queue.consume, log.logger, 60_000);
    receiver.setDispatcher(async () => notStored('database unavailable'));
    await receiver.onStart();
    await vi.waitFor(() => { expect(log.errors.length).toBe(1); });
    await receiver.onStop();
    expect(queue.messages.map((m) => m.body)).toEqual(['MSH|1']);
    expect(queue.acked).toEqual([]);
    receiver = null;
  });

  it('a stop waits for the message in progress however long it takes, and takes none after it (#413)', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    queue.publish('MSH|2');
    const held = await startHeld(queue);

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
    expect(queue.acked).toEqual(['MSH|1']);
    expect(queue.messages.map((m) => m.body)).toEqual(['MSH|2']);
    expect(held.offered).toEqual(['MSH|1']);
    receiver = null;
  });

  it('a halt does not wait, and a message recorded by then is acknowledged, not delivered again (#413)', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    queue.publish('MSH|2');
    const held = await startHeld(queue);

    expect((await receiver?.onHalt())?.ok).toBe(true);
    expect(queue.acked).toEqual([]);
    held.letGo(stored(1));
    await vi.waitFor(() => { expect(queue.openConnections).toBe(0); });

    expect(queue.acked).toEqual(['MSH|1']);
    expect(queue.messages.map((m) => m.body)).toEqual(['MSH|2']);
    expect(held.offered).toEqual(['MSH|1']);
    receiver = null;
  });

  it('a halt returns a message that was not recorded to the queue', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    const held = await startHeld(queue);

    await receiver?.onHalt();
    held.letGo(notStored('cancelled by the halt'));
    await vi.waitFor(() => { expect(queue.openConnections).toBe(0); });

    expect(queue.messages.map((m) => [m.body, m.redelivered])).toEqual([['MSH|1', true]]);
    receiver = null;
  });

  it.each([
    ['is rejected, as one stored with an error is, when the channel keeps its content', true, ['MSH|1'], []],
    ['returns to the queue when the channel does not', false, [], ['MSH|1']],
  ] as const)('a message that a halt ended with an error %s', async (_what, recoverable, deadLettered, left) => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    const held = await startHeld(queue, recoverable);

    await receiver?.onHalt();
    held.letGo(stored(1, DISPATCH_STATUS.ERROR));
    await vi.waitFor(() => { expect(queue.openConnections).toBe(0); });

    expect(queue.deadLettered).toEqual(deadLettered);
    expect(queue.messages.map((m) => m.body)).toEqual(left);
    receiver = null;
  });

  it.each(['onStop', 'onHalt', 'onUndeploy'] as const)('a start that an %s overtakes while it connects takes nothing and closes', async (action) => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let connected = (): void => undefined;
    queue.connecting = new Promise((resolve) => { connected = resolve; });
    const p = pipeline();
    receiver = new AmqpReceiver(config, queue.consume, makeMockLogger().logger, 5);
    receiver.setDispatcher(p.dispatch);

    const starting = receiver.onStart();
    await receiver[action]();
    connected();

    expect((await starting).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(p.offered).toEqual([]);
    expect(queue.openConnections).toBe(0);
    expect(queue.messages.map((m) => m.body)).toEqual(['MSH|1']);
    receiver = null;
  });

  it('a message whose destination the halt failed behind an early answer returns to the queue when the channel does not keep its content', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    const held = await startHeld(queue, false);

    await receiver?.onHalt();
    held.letGo({ ok: true, value: { messageId: 1, destinationFailed: true }, error: null });
    await vi.waitFor(() => { expect(queue.openConnections).toBe(0); });

    expect(queue.acked).toEqual([]);
    expect(queue.messages.map((m) => m.body)).toEqual(['MSH|1']);
    receiver = null;
  });

  it('a halt ends a stop that waits', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    const held = await startHeld(queue);

    const stopping = receiver?.onStop();
    await receiver?.onHalt();
    expect((await stopping)?.ok).toBe(true);
    held.letGo(stored(1));
    await vi.waitFor(() => { expect(queue.openConnections).toBe(0); });

    expect(queue.acked).toEqual(['MSH|1']);
    receiver = null;
  });

  it.each([
    ['halt', 'onHalt', 2_000],
    ['stop', 'onStop', 10_000],
  ] as const)('a %s ends although the broker never answers the close (#413)', async (_what, action, withinMs) => {
    const queue = new FakeAmqpQueue();
    queue.hangCloses = true;
    await start(queue, pipeline().dispatch);

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
  it('maps routing details and headers into the source map', () => {
    const raw = toRawMessage({
      content: Buffer.from('MSH|1'),
      exchange: 'hl7',
      routingKey: 'adt.a01',
      redelivered: false,
      headers: { site: 'north' },
      messageId: 'm-1',
      contentType: 'text/plain',
      ack: () => undefined,
      nack: () => undefined,
    }, 'adt');
    expect(raw).toEqual({
      content: 'MSH|1',
      sourceMap: { queue: 'adt', exchange: 'hl7', routingKey: 'adt.a01', redelivered: false, headers: { site: 'north' }, messageId: 'm-1', contentType: 'text/plain' },
    });
  });

  const delivery = (content: Buffer) => ({
    content, exchange: '', routingKey: 'adt', redelivered: false, headers: {}, messageId: undefined, contentType: undefined,
    ack: () => undefined, nack: () => undefined,
  });

  it('decodes a Latin-1 payload when the charset is latin1', () => {
    const raw = toRawMessage(delivery(Buffer.from([...Buffer.from('PID|Jos'), 0xe9])), 'adt', 'latin1');
    expect(raw.content).toBe('PID|José');
    expect(raw.sourceMap['charsetError']).toBeUndefined();
  });

  it('decodes Windows-1252 punctuation when the charset is windows-1252', () => {
    expect(toRawMessage(delivery(Buffer.from([0x93, 0x41, 0x94])), 'adt', 'windows-1252').content).toBe('“A”');
  });

  it('keeps a binary payload intact as base64 when the charset is base64', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x80, 0x0d, 0x0a]);
    const raw = toRawMessage(delivery(bytes), 'adt', 'base64');
    expect(Buffer.from(raw.content, 'base64').equals(bytes)).toBe(true);
  });

  it('flags a payload that is not valid UTF-8', () => {
    const raw = toRawMessage(delivery(Buffer.from([0x41, 0xc3])), 'adt');
    expect(raw.content).toBe('A�');
    expect(raw.sourceMap['charsetError']).toContain('not valid UTF-8');
  });

  it('keeps a UTF-8 byte order mark as it did before', () => {
    expect(toRawMessage(delivery(Buffer.from([0xef, 0xbb, 0xbf, 0x41])), 'adt').content).toBe('﻿A');
  });
});

describe('charset', () => {
  it('logs a warning, without the payload, for a message that is not valid UTF-8, and still stores it', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('x');
    const p = pipeline();
    const log = makeMockLogger();
    const consume: typeof queue.consume = (c, onDelivery) =>
      queue.consume(c, (d) => { onDelivery({ ...d, content: Buffer.from([0x50, 0xe9]) }); });
    receiver = new AmqpReceiver(config, consume, log.logger, 5);
    receiver.setDispatcher(p.dispatch);
    await receiver.onStart();
    await vi.waitFor(() => { expect(queue.acked).toEqual(['x']); });
    expect(p.offered[0]?.sourceMap['charsetError']).toContain('not valid UTF-8');
    const warning = log.warnings.find((w) => w.msg.includes('not valid UTF-8'));
    expect(warning).toBeDefined();
    expect(JSON.stringify(warning)).not.toContain('P�');
  });
});

describe('headersToRecord', () => {
  it('turns byte strings into text and nested tables into JSON text', () => {
    expect(headersToRecord({
      text: 'a',
      count: 3,
      flag: true,
      none: null,
      bytes: Buffer.from('xyz'),
      big: 12345678901234567890n,
      when: new Date('2026-11-14T00:00:00Z'),
      nested: { a: 1, b: [1, 2] },
    })).toEqual({
      text: 'a',
      count: 3,
      flag: true,
      none: null,
      bytes: 'xyz',
      big: '12345678901234567890',
      when: '2026-11-14T00:00:00.000Z',
      nested: '{"a":1,"b":[1,2]}',
    });
  });

  it.each([
    ['text', '{"__proto__":"x","site":"north"}'],
    ['null', '{"__proto__":null,"site":"north"}'],
  ])('keeps a header named __proto__ (%s)', (_kind, json) => {
    // JSON.parse makes it an own property, as amqplib's decoder does.
    const record = headersToRecord(JSON.parse(json) as Record<string, unknown>);
    expect(JSON.stringify(record)).toBe(json);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });

  it('gives no headers as an empty record', () => {
    expect(headersToRecord(undefined)).toEqual({});
  });

  it.each([
    ['an empty table', {}],
    ['an empty array', []],
    ['arrays in tables in arrays', [{ a: [1, { b: [] }], c: {} }, [], 'x']],
    ['every scalar', { s: 'a"b\\\n\u2028', n: -1.5, t: true, f: false, v: null, nan: NaN }],
    ['a name that needs escaping', { 'a"b\n': { '': 1 } }],
    ['a decimal and a timestamp', { d: { '!': 'decimal', value: { places: 2, digits: 314 } }, t: { '!': 'timestamp', value: 1 } }],
    ['bytes and a date inside a table', { bytes: Buffer.from('xyz'), when: new Date('2026-11-14T00:00:00Z') }],
    ['a table with a __proto__ name', JSON.parse('{"__proto__":{"a":1}}')],
    ['a table with a toJSON name', { toJSON: 'text' }],
  ])('writes %s as JSON.stringify does', (_name, value: unknown) => {
    expect(headersToRecord({ x: value })).toEqual({ x: JSON.stringify(value) });
  });

  it('writes a big integer inside a table as text', () => {
    expect(headersToRecord({ x: [{ big: 12345678901234567890n }] })).toEqual({ x: '[{"big":"12345678901234567890"}]' });
  });

  // A default 128 KB frame nests about 26,000 arrays, or 22,000 tables.
  it('keeps every level of tables and arrays nested tens of thousands deep', () => {
    let arrays: unknown = 'leaf';
    for (let i = 0; i < 26_000; i += 1) arrays = [arrays];
    expect(headersToRecord({ tables: nestedTables(26_000), arrays })).toEqual({
      tables: nestedTablesJson(26_000),
      arrays: `${'['.repeat(26_000)}"leaf"${']'.repeat(26_000)}`,
    });
  });

  it('writes a missing value inside a table or array as null, so the text stays JSON', () => {
    expect(headersToRecord({ x: [undefined, { a: undefined }] })).toEqual({ x: '[null,{"a":null}]' });
  });

  it('keeps every item of an array with 131,072 items', () => {
    const wide = Array.from({ length: 131_072 }, () => null);
    expect(headersToRecord({ wide })).toEqual({ wide: JSON.stringify(wide) });
  });
});
