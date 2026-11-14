// ===========================================
// AMQP Receiver Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import type { RawMessage, DispatchResult } from '../../base.js';
import { DISPATCH_STATUS } from '../../base.js';
import { AmqpReceiver, toRawMessage, type AmqpReceiverConfig } from '../amqp-receiver.js';
import { headersToRecord } from '../amqp-client.js';
import { FakeAmqpQueue } from '../../__fixtures__/fake-amqp.js';
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
      // The connection drops while the first message is being stored.
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

  it('halt disconnects at once and the message in progress goes back to the queue', async () => {
    const queue = new FakeAmqpQueue();
    queue.publish('MSH|1');
    let entered = false;
    await start(queue, async () => { entered = true; return new Promise<Result<DispatchResult>>(() => undefined); });
    await vi.waitFor(() => { expect(entered).toBe(true); });
    expect((await receiver?.onHalt())?.ok).toBe(true);
    expect(queue.connected).toBe(false);
    expect(queue.messages.map((m) => [m.body, m.redelivered])).toEqual([['MSH|1', true]]);
    receiver = null;
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

  it('gives no headers as an empty record', () => {
    expect(headersToRecord(undefined)).toEqual({});
  });
});
