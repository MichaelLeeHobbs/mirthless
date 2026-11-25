import { describe, it, expect, vi } from 'vitest';
import { RecoveryManager, type RecoveryStore, type UnprocessedMessage, type ConnectorMessageRecord } from '../recovery-manager.js';
import type { Result } from '@galvanigraph/core-util';

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function fail(message: string): Result<never> {
  return { ok: false, value: null, error: new Error(message) } as unknown as Result<never>;
}

function row(messageId: number, metaDataId: number, status: string): ConnectorMessageRecord {
  return { messageId, metaDataId, status, connectorName: metaDataId === 0 ? 'Source' : `Partner ${String(metaDataId)}` };
}

function makeStore(
  messages: readonly UnprocessedMessage[],
  connectorMap: ReadonlyMap<number, readonly ConnectorMessageRecord[]>,
): RecoveryStore {
  return {
    getUnprocessedMessages: vi.fn().mockImplementation(
      (_channelId: string, afterMessageId: number, limit: number) =>
        Promise.resolve(ok(messages.filter((m) => m.messageId > afterMessageId).slice(0, limit))),
    ),
    getConnectorMessages: vi.fn().mockImplementation(
      (_channelId: string, messageId: number) => {
        const conns = connectorMap.get(messageId) ?? [];
        return Promise.resolve(ok(conns));
      },
    ),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    finishSource: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

const RUNNING = new AbortController().signal;

describe('RecoveryManager', () => {
  it('returns zeros when no unprocessed messages', async () => {
    const store = makeStore([], new Map());
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ recovered: 0, errors: 0, skipped: 0, interrupted: false });
  });

  it('reprocesses source connector with RECEIVED status', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 1, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [1, [row(1, 0, 'RECEIVED')]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovered).toBe(1);
    expect(reprocess).toHaveBeenCalledWith(CHANNEL_ID, 1);
  });

  it('re-dispatches destination connector with RECEIVED status', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 2, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [2, [
        row(2, 0, 'SENT'),
        row(2, 1, 'RECEIVED'),
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovered).toBe(1);
    expect(redispatch).toHaveBeenCalledWith(CHANNEL_ID, row(2, 1, 'RECEIVED'));
    expect(reprocess).not.toHaveBeenCalled();
  });

  it.each(['QUEUED', 'PENDING'])('leaves a %s destination to the queue and closes the message, as the pipeline does', async (status) => {
    const msgs: UnprocessedMessage[] = [{ messageId: 3, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [3, [row(3, 0, 'TRANSFORMED'), row(3, 1, status)]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok && result.value).toMatchObject({ recovered: 0, errors: 0, skipped: 2 });
    expect(redispatch).not.toHaveBeenCalled();
    expect(store.finishSource).toHaveBeenCalledWith(CHANNEL_ID, 3, 'SENT');
    expect(store.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 3);
  });

  it('skips SENT/FILTERED/ERROR status connectors', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 4, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [4, [
        row(4, 0, 'SENT'),
        row(4, 1, 'FILTERED'),
        row(4, 2, 'ERROR'),
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(3);
    expect(result.value.recovered).toBe(0);
  });

  it('counts errors when reprocess fails', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 5, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [5, [row(5, 0, 'RECEIVED')]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(fail('reprocess failed'));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors).toBe(1);
    expect(result.value.recovered).toBe(0);
  });

  it('counts errors when connector messages query fails', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 6, channelId: CHANNEL_ID }];
    const store: RecoveryStore = {
      getUnprocessedMessages: vi.fn().mockResolvedValue(ok(msgs)),
      getConnectorMessages: vi.fn().mockResolvedValue(fail('db error')),
      markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
      finishSource: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors).toBe(1);
    expect(result.value.recovered).toBe(0);
  });

  it('handles mixed statuses across multiple messages', async () => {
    const msgs: UnprocessedMessage[] = [
      { messageId: 10, channelId: CHANNEL_ID },
      { messageId: 11, channelId: CHANNEL_ID },
    ];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [10, [
        row(10, 0, 'RECEIVED'),
      ]],
      [11, [
        row(11, 0, 'SENT'),
        row(11, 1, 'QUEUED'),
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovered).toBe(1);
    expect(result.value.skipped).toBe(2);
  });

  it('returns error when getUnprocessedMessages fails', async () => {
    const store: RecoveryStore = {
      getUnprocessedMessages: vi.fn().mockResolvedValue(fail('db down')),
      getConnectorMessages: vi.fn(),
      markProcessed: vi.fn(),
      finishSource: vi.fn(),
    };
    const reprocess = vi.fn();
    const redispatch = vi.fn();
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(false);
  });

  it.each([
    ['SENT', { recovered: 1, errors: 0 }],
    ['QUEUED', { recovered: 1, errors: 0 }],
    ['ERROR', { recovered: 0, errors: 1 }],
  ])('closes a message whose destination was recorded %s', async (outcome, counts) => {
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [8, [row(8, 0, 'TRANSFORMED'), row(8, 1, 'RECEIVED')]],
    ]);
    const store = makeStore([{ messageId: 8, channelId: CHANNEL_ID }], conns);
    const redispatch = vi.fn(async () => {
      conns.set(8, [row(8, 0, 'TRANSFORMED'), row(8, 1, outcome)]);
      return ok(outcome as 'SENT');
    });

    const result = await new RecoveryManager(store, vi.fn(), redispatch).recover(CHANNEL_ID, RUNNING);

    expect(result.ok && result.value).toMatchObject(counts);
    expect(store.finishSource).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 8, outcome === 'ERROR' ? 'ERROR' : 'SENT');
    expect(store.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 8);
  });

  it('goes on with the other destinations after one it could not record, and leaves the message unprocessed', async () => {
    const store = makeStore([{ messageId: 9, channelId: CHANNEL_ID }], new Map([[9, [
      row(9, 0, 'TRANSFORMED'), row(9, 1, 'RECEIVED'), row(9, 2, 'RECEIVED'),
    ]]]));
    const redispatch = vi.fn().mockResolvedValueOnce(fail('db down')).mockResolvedValueOnce(ok('SENT'));

    const result = await new RecoveryManager(store, vi.fn(), redispatch).recover(CHANNEL_ID, RUNNING);

    expect(redispatch.mock.calls.map((c: unknown[]) => c[1])).toEqual([row(9, 1, 'RECEIVED'), row(9, 2, 'RECEIVED')]);
    expect(result.ok && result.value).toMatchObject({ recovered: 1, errors: 1 });
    expect(store.finishSource).not.toHaveBeenCalled();
    expect(store.markProcessed).not.toHaveBeenCalled();
  });

  it('handles redispatch failure as error count', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 7, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [7, [
        row(7, 0, 'SENT'),
        row(7, 1, 'RECEIVED'),
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(fail('dispatch failed'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors).toBe(1);
    expect(result.value.recovered).toBe(0);
  });

  it('reprocesses a source left TRANSFORMED when the crash hit before routing', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 20, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [20, [row(20, 0, 'TRANSFORMED')]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, vi.fn());

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(reprocess).toHaveBeenCalledWith(CHANNEL_ID, 20);
    expect(result.ok && result.value.recovered).toBe(1);
    // The pipeline that runs it again finishes it.
    expect(store.markProcessed).not.toHaveBeenCalled();
  });

  it.each([['source first', false], ['source last', true]])('runs a message again once, and leaves its destinations to that, when it stopped after they were recorded and before routing: %s', async (_order, reversed) => {
    const rows: ConnectorMessageRecord[] = [
      row(25, 0, 'RECEIVED'), row(25, 1, 'RECEIVED'), row(25, 2, 'RECEIVED'),
    ];
    const store = makeStore([{ messageId: 25, channelId: CHANNEL_ID }], new Map([[25, reversed ? rows.reverse() : rows]]));
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok('ERROR'));

    const result = await new RecoveryManager(store, reprocess, redispatch).recover(CHANNEL_ID, RUNNING);

    expect(reprocess).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 25);
    expect(redispatch).not.toHaveBeenCalled();
    expect(result.ok && result.value).toMatchObject({ recovered: 1, errors: 0 });
  });

  it('does not run a message again once the channel has begun to stop', async () => {
    const stop = new AbortController();
    const store = makeStore([{ messageId: 26, channelId: CHANNEL_ID }], new Map([[26, [row(26, 0, 'RECEIVED')]]]));
    const read = vi.mocked(store.getConnectorMessages).getMockImplementation()!;
    vi.mocked(store.getConnectorMessages).mockImplementation(async (...args) => { stop.abort(); return read(...args); });
    const reprocess = vi.fn();

    const result = await new RecoveryManager(store, reprocess, vi.fn()).recover(CHANNEL_ID, stop.signal);

    expect(reprocess).not.toHaveBeenCalled();
    expect(result.ok && result.value).toEqual({ recovered: 0, errors: 0, skipped: 0, interrupted: true });
  });

  it('does not reprocess a TRANSFORMED source once destinations exist (no duplicate sends)', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 21, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [21, [
        row(21, 0, 'TRANSFORMED'),
        row(21, 1, 'SENT'),
        row(21, 2, 'RECEIVED'),
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn();
    const redispatch = vi.fn().mockResolvedValue(ok('SENT'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    await mgr.recover(CHANNEL_ID, RUNNING);

    expect(reprocess).not.toHaveBeenCalled();
    expect(redispatch).toHaveBeenCalledWith(CHANNEL_ID, row(21, 2, 'RECEIVED'));
    expect(store.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 21);
  });

  it('marks a message processed when every connector is already final', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 22, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [22, [row(22, 0, 'TRANSFORMED'), row(22, 1, 'SENT')]],
    ]);
    const store = makeStore(msgs, conns);
    const mgr = new RecoveryManager(store, vi.fn(), vi.fn());

    await mgr.recover(CHANNEL_ID, RUNNING);

    expect(store.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 22);
  });

  it('gives a routed source its final status: SENT when every destination delivered', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 30, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [30, [row(30, 0, 'TRANSFORMED'), row(30, 1, 'RECEIVED')]],
    ]);
    const store = makeStore(msgs, conns);
    const redispatch = vi.fn().mockImplementation(async () => {
      conns.set(30, [row(30, 0, 'TRANSFORMED'), row(30, 1, 'SENT')]);
      return ok('SENT');
    });

    await new RecoveryManager(store, vi.fn(), redispatch).recover(CHANNEL_ID, RUNNING);

    expect(store.finishSource).toHaveBeenCalledWith(CHANNEL_ID, 30, 'SENT');
    expect(store.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 30);
  });

  it('gives a routed source ERROR when a destination ended in error', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 31, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [31, [row(31, 0, 'TRANSFORMED'), row(31, 1, 'SENT'), row(31, 2, 'ERROR')]],
    ]);
    const store = makeStore(msgs, conns);

    await new RecoveryManager(store, vi.fn(), vi.fn()).recover(CHANNEL_ID, RUNNING);

    expect(store.finishSource).toHaveBeenCalledWith(CHANNEL_ID, 31, 'ERROR');
  });

  it('does not touch a source that already has its final status', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 32, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [32, [row(32, 0, 'SENT'), row(32, 1, 'SENT')]],
    ]);
    const store = makeStore(msgs, conns);

    await new RecoveryManager(store, vi.fn(), vi.fn()).recover(CHANNEL_ID, RUNNING);

    expect(store.finishSource).not.toHaveBeenCalled();
    expect(store.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 32);
  });

  it('leaves the message unprocessed when the final source status cannot be saved', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 33, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [33, [row(33, 0, 'TRANSFORMED'), row(33, 1, 'SENT')]],
    ]);
    const store = makeStore(msgs, conns);
    vi.mocked(store.finishSource).mockResolvedValue(fail('db down'));

    const result = await new RecoveryManager(store, vi.fn(), vi.fn()).recover(CHANNEL_ID, RUNNING);

    expect(store.markProcessed).not.toHaveBeenCalled();
    expect(result.ok && result.value.errors).toBe(1);
  });

  it('reads unprocessed messages a page at a time and recovers them all', async () => {
    const msgs: UnprocessedMessage[] = Array.from({ length: 450 }, (_, i) => ({ messageId: i + 1, channelId: CHANNEL_ID }));
    const conns = new Map<number, ConnectorMessageRecord[]>(msgs.map((m) => [m.messageId, [row(m.messageId, 0, 'RECEIVED')]]));
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, vi.fn());

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok && result.value.recovered).toBe(450);
    const calls = (store.getUnprocessedMessages as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c: unknown[]) => [c[1], c[2]])).toEqual([[0, 200], [200, 200], [400, 200]]);
  });

  it('does not loop forever on messages that keep failing', async () => {
    const msgs: UnprocessedMessage[] = Array.from({ length: 200 }, (_, i) => ({ messageId: i + 1, channelId: CHANNEL_ID }));
    const conns = new Map<number, ConnectorMessageRecord[]>(msgs.map((m) => [m.messageId, [row(m.messageId, 0, 'RECEIVED')]]));
    const store = makeStore(msgs, conns);
    const mgr = new RecoveryManager(store, vi.fn().mockResolvedValue(fail('still broken')), vi.fn());

    const result = await mgr.recover(CHANNEL_ID, RUNNING);

    expect(result.ok && result.value.errors).toBe(200);
    expect(store.getUnprocessedMessages).toHaveBeenCalledTimes(2);
  });

  describe('when the channel stops', () => {
    const received = (count: number): { readonly msgs: UnprocessedMessage[]; readonly conns: Map<number, ConnectorMessageRecord[]> } => {
      const msgs = Array.from({ length: count }, (_, i) => ({ messageId: i + 1, channelId: CHANNEL_ID }));
      return { msgs, conns: new Map(msgs.map((m) => [m.messageId, [row(m.messageId, 1, 'RECEIVED')]])) };
    };

    it('takes no message after it, and says it was interrupted', async () => {
      const stop = new AbortController();
      const { msgs, conns } = received(12);
      const store = makeStore(msgs, conns);
      const redispatched: number[] = [];
      const redispatch = vi.fn(async (_c: string, { messageId }: ConnectorMessageRecord) => {
        redispatched.push(messageId);
        if (messageId === 5) stop.abort();
        return ok('SENT' as const);
      });

      const result = await new RecoveryManager(store, vi.fn(), redispatch).recover(CHANNEL_ID, stop.signal);

      expect(store.getConnectorMessages).toHaveBeenCalledTimes(5);
      expect(redispatched).toEqual([1, 2, 3, 4, 5]);
      expect(result.ok && result.value).toMatchObject({ recovered: 5, errors: 0, interrupted: true });
    });

    it('reads no further page after it', async () => {
      const stop = new AbortController();
      const { msgs, conns } = received(450);
      const store = makeStore(msgs, conns);
      const redispatch = vi.fn(async (_c: string, { messageId }: ConnectorMessageRecord) => {
        if (messageId === 200) stop.abort();
        return ok('SENT' as const);
      });

      await new RecoveryManager(store, vi.fn(), redispatch).recover(CHANNEL_ID, stop.signal);

      expect(store.getUnprocessedMessages).toHaveBeenCalledOnce();
    });

    it('leaves a message unprocessed when it came between two of its destinations', async () => {
      const stop = new AbortController();
      const store = makeStore([{ messageId: 1, channelId: CHANNEL_ID }], new Map([[1, [
        row(1, 1, 'RECEIVED'), row(1, 2, 'RECEIVED'),
      ]]]));
      const redispatch = vi.fn(async () => { stop.abort(); return ok('SENT' as const); });

      const result = await new RecoveryManager(store, vi.fn(), redispatch).recover(CHANNEL_ID, stop.signal);

      expect(redispatch).toHaveBeenCalledOnce();
      expect(store.markProcessed).not.toHaveBeenCalled();
      expect(result.ok && result.value.interrupted).toBe(true);
    });
  });

  it('recovers at most a few messages at once', async () => {
    const msgs: UnprocessedMessage[] = Array.from({ length: 40 }, (_, i) => ({ messageId: i + 1, channelId: CHANNEL_ID }));
    const conns = new Map<number, ConnectorMessageRecord[]>(msgs.map((m) => [m.messageId, [row(m.messageId, 0, 'RECEIVED')]]));
    let running = 0;
    let peak = 0;
    const reprocess = vi.fn().mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      running -= 1;
      return ok(undefined);
    });
    const mgr = new RecoveryManager(makeStore(msgs, conns), reprocess, vi.fn());

    await mgr.recover(CHANNEL_ID, RUNNING);

    expect(reprocess).toHaveBeenCalledTimes(40);
    expect(peak).toBeLessThanOrEqual(5);
  });
});
