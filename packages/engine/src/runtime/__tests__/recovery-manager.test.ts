// ===========================================
// Recovery Manager Tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import { RecoveryManager, type RecoveryStore, type UnprocessedMessage, type ConnectorMessageRecord } from '../recovery-manager.js';
import type { Result } from '@mirthless/core-util';

// ----- Helpers -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function fail(message: string): Result<never> {
  return { ok: false, value: null, error: new Error(message) } as unknown as Result<never>;
}

function makeStore(
  messages: readonly UnprocessedMessage[],
  connectorMap: ReadonlyMap<number, readonly ConnectorMessageRecord[]>,
): RecoveryStore {
  return {
    getUnprocessedMessages: vi.fn().mockResolvedValue(ok(messages)),
    getConnectorMessages: vi.fn().mockImplementation(
      (_channelId: string, messageId: number) => {
        const conns = connectorMap.get(messageId) ?? [];
        return Promise.resolve(ok(conns));
      },
    ),
  };
}

// ----- Tests -----

describe('RecoveryManager', () => {
  it('returns zeros when no unprocessed messages', async () => {
    const store = makeStore([], new Map());
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ recovered: 0, errors: 0, skipped: 0 });
  });

  it('reprocesses source connector with RECEIVED status', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 1, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [1, [{ messageId: 1, metaDataId: 0, status: 'RECEIVED' }]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovered).toBe(1);
    expect(reprocess).toHaveBeenCalledWith(CHANNEL_ID, 1);
  });

  it('re-dispatches destination connector with RECEIVED status', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 2, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [2, [
        { messageId: 2, metaDataId: 0, status: 'SENT' },
        { messageId: 2, metaDataId: 1, status: 'RECEIVED' },
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovered).toBe(1);
    expect(redispatch).toHaveBeenCalledWith(CHANNEL_ID, 2, 1);
    expect(reprocess).not.toHaveBeenCalled();
  });

  it('skips QUEUED messages (handled by QueueConsumer)', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 3, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [3, [{ messageId: 3, metaDataId: 1, status: 'QUEUED' }]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(1);
    expect(result.value.recovered).toBe(0);
  });

  it('skips SENT/FILTERED/ERROR status connectors', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 4, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [4, [
        { messageId: 4, metaDataId: 0, status: 'SENT' },
        { messageId: 4, metaDataId: 1, status: 'FILTERED' },
        { messageId: 4, metaDataId: 2, status: 'ERROR' },
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(3);
    expect(result.value.recovered).toBe(0);
  });

  it('counts errors when reprocess fails', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 5, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [5, [{ messageId: 5, metaDataId: 0, status: 'RECEIVED' }]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(fail('reprocess failed'));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

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
    };
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

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
        { messageId: 10, metaDataId: 0, status: 'RECEIVED' },
      ]],
      [11, [
        { messageId: 11, metaDataId: 0, status: 'SENT' },
        { messageId: 11, metaDataId: 1, status: 'QUEUED' },
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(ok(undefined));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovered).toBe(1);
    expect(result.value.skipped).toBe(2);
  });

  it('returns error when getUnprocessedMessages fails', async () => {
    const store: RecoveryStore = {
      getUnprocessedMessages: vi.fn().mockResolvedValue(fail('db down')),
      getConnectorMessages: vi.fn(),
    };
    const reprocess = vi.fn();
    const redispatch = vi.fn();
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(false);
  });

  it('handles redispatch failure as error count', async () => {
    const msgs: UnprocessedMessage[] = [{ messageId: 7, channelId: CHANNEL_ID }];
    const conns = new Map<number, ConnectorMessageRecord[]>([
      [7, [
        { messageId: 7, metaDataId: 0, status: 'SENT' },
        { messageId: 7, metaDataId: 1, status: 'RECEIVED' },
      ]],
    ]);
    const store = makeStore(msgs, conns);
    const reprocess = vi.fn().mockResolvedValue(ok(undefined));
    const redispatch = vi.fn().mockResolvedValue(fail('dispatch failed'));
    const mgr = new RecoveryManager(store, reprocess, redispatch);

    const result = await mgr.recover(CHANNEL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors).toBe(1);
    expect(result.value.recovered).toBe(0);
  });
});
