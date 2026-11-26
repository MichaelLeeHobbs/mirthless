import { describe, expect, it, vi } from 'vitest';
import type { Result } from 'stderr-lib';
import type { DestinationResponse } from '@galvanigraph/engine';
import { handOffIn, pauseBeforeNextLook, sendOnce, type ChannelSend, type HandOffStore } from '../channel-hand-off.js';

const SENDER = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const KEY = { channelId: SENDER, messageId: 7, metaDataId: 1 };
const RECORDED = JSON.stringify({ channelId: TARGET, messageId: 40 });

const ok = <T>(value: T): Result<T> => ({ ok: true, value, error: null }) as Result<T>;
const failed = <T>(message: string): Result<T> => ({ ok: false, value: null, error: new Error(message) }) as Result<T>;
const SENT_NOW = ok<DestinationResponse>({ status: 'SENT', content: 'messageId=41' });

type State = { readonly processed: boolean; readonly status: string | null } | null;

function storeWith(recorded: Result<string | null>, states: readonly Result<State>[] = [], overrides: Partial<HandOffStore> = {}): HandOffStore {
  const sourceState = vi.fn<HandOffStore['sourceState']>();
  for (const state of states) sourceState.mockResolvedValueOnce(state);
  return {
    handedTo: vi.fn(async () => recorded),
    forget: vi.fn(async () => ok(undefined)),
    sourceState,
    isStarted: vi.fn(() => true),
    onRepeat: vi.fn(),
    onUnread: vi.fn(),
    pause: vi.fn(async () => undefined),
    ...overrides,
  };
}

function channelSend(overrides: Partial<ChannelSend> = {}): ChannelSend & { readonly send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => SENT_NOW);
  return { key: KEY, target: TARGET, halt: new AbortController().signal, deadline: new AbortController().signal, ...overrides, send };
}

describe('handOffIn', () => {
  const channelMap = { connectorType: 'CHANNEL', sourceChannelId: SENDER, sourceMessageId: 7, sourceMetaDataId: 1 };

  it('reads the send a Channel Writer names', () => {
    expect(handOffIn(channelMap)).toEqual(KEY);
  });

  it('reads a message id the queue passed as the text of a bigint', () => {
    expect(handOffIn({ ...channelMap, sourceMessageId: '7' })).toEqual(KEY);
  });

  it.each([
    ['another connector', { ...channelMap, connectorType: 'JAVASCRIPT' }],
    ['no sending channel', { ...channelMap, sourceChannelId: undefined }],
    ['a sending channel that is no id', { ...channelMap, sourceChannelId: 'channel-a' }],
    ['a message id that is not a whole number', { ...channelMap, sourceMessageId: 7.5 }],
    ['the source as the destination', { ...channelMap, sourceMetaDataId: 0 }],
  ])('names none for %s', (_what, sourceMap) => {
    expect(handOffIn(sourceMap)).toBeNull();
  });
});

describe('sendOnce', () => {
  it('sends a first send without asking, and removes what the target recorded once it returns', async () => {
    const store = storeWith(ok(RECORDED));
    const send = channelSend({ target: null });

    expect(await sendOnce(send, store)).toEqual(SENT_NOW);

    expect(store.handedTo).not.toHaveBeenCalled();
    expect(send.send).toHaveBeenCalledOnce();
    expect(store.forget).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it('removes it after a send that failed too', async () => {
    const store = storeWith(ok(null));
    const send = channelSend();
    send.send.mockResolvedValueOnce(ok({ status: 'ERROR', content: '' }));

    expect(await sendOnce(send, store)).toEqual(ok({ status: 'ERROR', content: '' }));
    expect(store.forget).toHaveBeenCalledOnce();
  });

  it.each(['SENT', 'FILTERED'])('does not send again what the target finished %s, and says which message it is', async (status) => {
    const store = storeWith(ok(RECORDED), [ok({ processed: true, status })]);
    const send = channelSend();

    expect(await sendOnce(send, store)).toEqual(ok({ status: 'SENT', content: 'messageId=40' }));

    expect(send.send).not.toHaveBeenCalled();
    expect(store.sourceState).toHaveBeenCalledWith(TARGET, 40);
    expect(store.onRepeat).toHaveBeenCalledExactlyOnceWith(KEY, { channelId: TARGET, messageId: 40 });
    expect(store.forget).toHaveBeenCalledOnce();
  });

  it('takes a source status of SENT as delivered before the message is marked finished, as with a destination still queued', async () => {
    const send = channelSend();
    expect(await sendOnce(send, storeWith(ok(RECORDED), [ok({ processed: false, status: 'SENT' })]))).toEqual(ok({ status: 'SENT', content: 'messageId=40' }));
    expect(send.send).not.toHaveBeenCalled();
  });

  it.each([true, false])('reads ERROR, final, for what the target failed (marked finished: %s), and does not send it again', async (processed) => {
    const store = storeWith(ok(RECORDED), [ok({ processed, status: 'ERROR' })]);
    const send = channelSend();

    expect(await sendOnce(send, store)).toEqual(ok({
      status: 'ERROR', content: '', final: true,
      errorMessage: `Target channel ${TARGET} recorded message 40, from a send a server stop interrupted, with an ERROR status`,
    }));
    expect(send.send).not.toHaveBeenCalled();
    expect(store.forget).toHaveBeenCalledOnce();
  });

  it.each<[string, Result<string | null>, readonly Result<State>[]]>([
    ['nothing was recorded', ok(null), []],
    ['what was recorded cannot be read as JSON', ok('{'), []],
    ['what was recorded names no message', ok(JSON.stringify({ channelId: TARGET })), []],
    ['the target finished it without a final status', ok(RECORDED), [ok({ processed: true, status: 'TRANSFORMED' })]],
    ['the target message is gone', ok(RECORDED), [ok(null)]],
  ])('sends when %s', async (_why, recorded, states) => {
    const store = storeWith(recorded, states);
    const send = channelSend();

    expect(await sendOnce(send, store)).toEqual(SENT_NOW);
    expect(send.send).toHaveBeenCalledOnce();
    expect(store.onRepeat).not.toHaveBeenCalled();
  });

  it('sends when the destination now sends to another channel', async () => {
    const store = storeWith(ok(RECORDED));
    const send = channelSend({ target: SENDER });

    expect(await sendOnce(send, store)).toEqual(SENT_NOW);
    expect(store.sourceState).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<HandOffStore>]>([
    ['what the target recorded', { handedTo: vi.fn(async () => failed<string | null>('db down')) }],
    ["the target message's state", { sourceState: vi.fn(async () => failed<State>('db down')) }],
  ])('sends, and says so, when %s cannot be read', async (_what, overrides) => {
    const store = storeWith(ok(RECORDED), [], overrides);
    const send = channelSend();

    expect(await sendOnce(send, store)).toEqual(SENT_NOW);
    expect(store.onUnread).toHaveBeenCalledExactlyOnceWith(KEY, new Error('db down'));
  });

  it('returns what was sent when what the target recorded cannot be removed, and says so', async () => {
    const store = storeWith(ok(null), [], { forget: vi.fn(async () => failed<void>('db down')) });

    expect(await sendOnce(channelSend(), store)).toEqual(SENT_NOW);
    expect(store.onUnread).toHaveBeenCalledOnce();
  });

  describe('a target message that is not finished', () => {
    const open = ok<State>({ processed: false, status: 'RECEIVED' });

    it('waits while its channel runs, and does not send what it then delivers', async () => {
      const store = storeWith(ok(RECORDED), [open, open, ok({ processed: true, status: 'SENT' })]);
      const send = channelSend();

      expect(await sendOnce(send, store)).toEqual(ok({ status: 'SENT', content: 'messageId=40' }));
      expect(store.pause).toHaveBeenCalledTimes(2);
      expect(send.send).not.toHaveBeenCalled();
    });

    it('sends when its channel is not started, since nothing finishes it now', async () => {
      const store = storeWith(ok(RECORDED), [open], { isStarted: vi.fn(() => false) });
      const send = channelSend();

      expect(await sendOnce(send, store)).toEqual(SENT_NOW);
      expect(store.isStarted).toHaveBeenCalledWith(TARGET);
      expect(store.pause).not.toHaveBeenCalled();
    });

    it("sends once the send's time is up", async () => {
      const deadline = new AbortController();
      const store = storeWith(ok(RECORDED), [open, open], { pause: vi.fn(async () => { deadline.abort(); }) });
      const send = channelSend({ deadline: deadline.signal });

      expect(await sendOnce(send, store)).toEqual(SENT_NOW);
      expect(store.pause).toHaveBeenCalledOnce();
    });

    it('neither sends nor removes what the target recorded when the channel is halted', async () => {
      const halt = new AbortController();
      halt.abort();
      const store = storeWith(ok(RECORDED), [open]);
      const send = channelSend({ halt: halt.signal, deadline: halt.signal });

      const result = await sendOnce(send, store);

      expect(result).toMatchObject({ ok: false, error: { message: 'Interrupted: the channel was halted' } });
      expect(send.send).not.toHaveBeenCalled();
      expect(store.forget).not.toHaveBeenCalled();
    });
  });
});

describe('pauseBeforeNextLook', () => {
  it('ends at once when its signal aborts', async () => {
    const stop = new AbortController();
    const paused = pauseBeforeNextLook(stop.signal);
    stop.abort();
    await expect(paused).resolves.toBeUndefined();
  });
});
