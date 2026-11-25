import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { DestinationRedispatcher, type RedispatchConfig } from '../destination-redispatcher.js';
import type { DestinationConfig, MessageStore } from '../../pipeline/message-processor.js';

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const DESTINATION = 2;

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function fail(message: string): Result<never> {
  return { ok: false, value: null, error: new Error(message) } as unknown as Result<never>;
}

const contents = new Map<number, string>();
const store = {
  createMessage: vi.fn(),
  createConnectorMessage: vi.fn(),
  updateConnectorMessageStatus: vi.fn(),
  storeContent: vi.fn(),
  markProcessed: vi.fn(),
  enqueue: vi.fn(),
  loadContent: vi.fn(),
  dequeue: vi.fn(),
  release: vi.fn(),
  incrementStats: vi.fn(),
  removeContent: vi.fn(),
} satisfies MessageStore;
const send = vi.fn();
const variablesUsed = vi.fn();
const isForItsNumber = vi.fn();
const onError = vi.fn();
const onFailed = vi.fn();
const onStoreFailure = vi.fn();
let run = new AbortController();
let halt = new AbortController();

beforeEach(() => {
  vi.resetAllMocks();
  contents.clear();
  contents.set(CONTENT_TYPE.SENT, 'payload');
  for (const fn of Object.values(store)) fn.mockResolvedValue(ok(undefined));
  store.loadContent.mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) => ok(contents.get(contentType) ?? null));
  send.mockResolvedValue(ok({ status: 'SENT', content: 'ACK' }));
  variablesUsed.mockReturnValue([]);
  isForItsNumber.mockResolvedValue(ok(true));
  run = new AbortController();
  halt = new AbortController();
});

function partner(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return { metaDataId: DESTINATION, name: 'Lab', enabled: true, scripts: {}, queueMode: 'NEVER', ...overrides };
}

function redispatch(
  queueMode: DestinationConfig['queueMode'] = 'NEVER',
  overrides: Partial<RedispatchConfig> = {},
): ReturnType<DestinationRedispatcher['redispatch']> {
  return new DestinationRedispatcher({
    channelId: CHANNEL_ID, serverId: 'server-01', store, send, destinations: [partner({ metaDataId: 1, name: 'Other' }), partner({ queueMode })], isForItsNumber, variablesUsed,
    runSignal: run.signal, haltSignal: halt.signal, onError, onFailed, onStoreFailure, ...overrides,
  }).redispatch({ messageId: 7, metaDataId: DESTINATION, status: 'RECEIVED' });
}

const statuses = (): unknown[] => store.updateConnectorMessageStatus.mock.calls.map((c: unknown[]) => c.slice(1, 4));
const kept = (): unknown[] => store.storeContent.mock.calls.map((c: unknown[]) => [c[3], c[4]]);

describe('DestinationRedispatcher', () => {
  describe('a destination that takes it', () => {
    it('gets what was stored, is recorded as the pipeline records it, and loses what an earlier attempt left', async () => {
      expect(await redispatch()).toMatchObject({ ok: true, value: 'SENT' });

      expect(send).toHaveBeenCalledExactlyOnceWith(DESTINATION, 7, 'payload', expect.any(AbortSignal), undefined, undefined);
      expect(statuses()).toEqual([[7, DESTINATION, 'SENT']]);
      expect(store.incrementStats).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, DESTINATION, 'server-01', 'sent');
      expect(kept()).toEqual([[CONTENT_TYPE.RESPONSE, 'ACK']]);
      expect(store.removeContent).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 7, DESTINATION, CONTENT_TYPE.ERROR);
      expect(onError).not.toHaveBeenCalled();
    });

    it('is recorded by a store that cannot remove content', async () => {
      const { removeContent: _unused, ...plain } = store;
      expect(await redispatch('NEVER', { store: plain })).toMatchObject({ ok: true, value: 'SENT' });
    });

    it('is not sent it again when its status cannot be saved, which is reported', async () => {
      store.updateConnectorMessageStatus.mockResolvedValue(fail('db down'));

      expect(await redispatch()).toMatchObject({ ok: true, value: 'SENT' });

      expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith({
        channelId: CHANNEL_ID, messageId: 7, metaDataId: DESTINATION, what: 'the SENT status of a delivered destination', errorMessage: 'db down',
      });
    });

    it.each([
      ['its response', 'storeContent', 'the response of a delivered destination'],
      ['the removal of an earlier failure', 'removeContent', 'the removal of why an earlier attempt failed'],
    ] as const)('stays SENT when %s cannot be saved, and the report names it', async (_what, write, what) => {
      store[write].mockResolvedValue(fail('db down'));

      expect(await redispatch()).toMatchObject({ ok: true, value: 'SENT' });

      expect(statuses()).toEqual([[7, DESTINATION, 'SENT']]);
      expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith({ channelId: CHANNEL_ID, messageId: 7, metaDataId: DESTINATION, what, errorMessage: 'db down' });
    });

    it('reports its status and its response when neither can be saved', async () => {
      store.updateConnectorMessageStatus.mockResolvedValue(fail('db down'));
      store.storeContent.mockResolvedValue(fail('db down'));

      expect(await redispatch()).toMatchObject({ ok: true, value: 'SENT' });

      expect(onStoreFailure.mock.calls.map(([f]: unknown[]) => (f as { what: string }).what).sort())
        .toEqual(['the SENT status of a delivered destination', 'the response of a delivered destination']);
    });
  });

  describe('the destination it was prepared for', () => {
    it.each([
      ['is gone', [partner({ metaDataId: 1 })], 'no longer has the destination'],
      ['is switched off', [partner({ enabled: false })], 'switched off'],
    ])('%s: nothing is sent or queued, and it says why', async (_what, destinations, why) => {
      for (const queueMode of ['NEVER', 'ALWAYS'] as const) {
        vi.clearAllMocks();
        expect(await redispatch(queueMode, { destinations: destinations.map((d) => ({ ...d, queueMode })) })).toMatchObject({ ok: true, value: 'ERROR' });

        expect(send).not.toHaveBeenCalled();
        expect(store.enqueue).not.toHaveBeenCalled();
        expect(statuses()).toEqual([[7, DESTINATION, 'ERROR']]);
        expect(kept()).toEqual([[CONTENT_TYPE.PROCESSING_ERROR, expect.stringContaining(why)]]);
        expect(onError).toHaveBeenCalledOnce();
      }
    });

    it('is the one with its number, whatever it is called now', async () => {
      const destinations = [partner({ name: 'Clinic' }), partner({ metaDataId: 3 })];
      expect(await redispatch('NEVER', { destinations })).toMatchObject({ ok: true, value: 'SENT' });
      expect(isForItsNumber).toHaveBeenCalledExactlyOnceWith(7, DESTINATION);
    });

    it('is not known, for a message from when a save renumbered them: nothing is sent, and it says why', async () => {
      isForItsNumber.mockResolvedValue(ok(false));

      expect(await redispatch()).toMatchObject({ ok: true, value: 'ERROR' });

      expect(send).not.toHaveBeenCalled();
      expect(kept()).toEqual([[CONTENT_TYPE.PROCESSING_ERROR, expect.stringMatching(/not known to be for this one\. It may have been delivered/)]]);
    });

    it('cannot be told: it is left for a later recovery', async () => {
      isForItsNumber.mockResolvedValue(fail('db down'));

      expect(await redispatch()).toMatchObject({ ok: false, error: { message: 'db down' } });

      expect(send).not.toHaveBeenCalled();
      expect(statuses()).toEqual([]);
    });
  });

  describe('the variables of the message', () => {
    it.each(['NEVER', 'ON_FAILURE'] as const)('are sent as they were stored, under queue mode %s', async (queueMode) => {
      contents.set(CONTENT_TYPE.CHANNEL_MAP, '{"mrn":"123","dob":null}');
      variablesUsed.mockReturnValue(['mrn', 'room']);

      expect(await redispatch(queueMode)).toMatchObject({ ok: true, value: 'SENT' });

      expect(send.mock.calls[0]![5]).toEqual({ mrn: '123', dob: null });
    });

    it('were none, and kept as none: the destination gets it although it uses some', async () => {
      contents.set(CONTENT_TYPE.CHANNEL_MAP, '{}');
      variablesUsed.mockReturnValue(['mrn']);

      expect(await redispatch('ON_FAILURE')).toMatchObject({ ok: true, value: 'SENT' });

      expect(send.mock.calls[0]![5]).toEqual({});
    });

    it.each(['NEVER', 'ON_FAILURE', 'ALWAYS'] as const)('were not stored, and the destination uses some: nothing is sent or queued under queue mode %s', async (queueMode) => {
      variablesUsed.mockReturnValue(['mrn']);

      expect(await redispatch(queueMode)).toMatchObject({ ok: true, value: 'ERROR' });

      expect(variablesUsed).toHaveBeenCalledExactlyOnceWith(DESTINATION, 7, 'payload');
      expect(send).not.toHaveBeenCalled();
      expect(store.enqueue).not.toHaveBeenCalled();
      expect(statuses()).toEqual([[7, DESTINATION, 'ERROR']]);
      expect(kept()).toEqual([[CONTENT_TYPE.PROCESSING_ERROR, expect.stringContaining('variables (mrn)')]]);
      expect(onFailed).toHaveBeenCalledExactlyOnceWith(7, DESTINATION, expect.stringContaining('variables (mrn)'));
      expect(store.incrementStats).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, DESTINATION, 'server-01', 'errored');
    });

    it.each(['not JSON', '["mrn"]', '"mrn"', 'null'])('are no JSON object (%s): nothing is sent', async (text) => {
      contents.set(CONTENT_TYPE.CHANNEL_MAP, text);

      expect(await redispatch()).toMatchObject({ ok: true, value: 'ERROR' });

      expect(send).not.toHaveBeenCalled();
      expect(kept()).toEqual([[CONTENT_TYPE.PROCESSING_ERROR, expect.stringContaining('not a JSON object')]]);
    });
  });

  it('fails a destination that has nothing stored to send', async () => {
    contents.clear();

    expect(await redispatch('ALWAYS')).toMatchObject({ ok: true, value: 'ERROR' });

    expect(send).not.toHaveBeenCalled();
    expect(store.enqueue).not.toHaveBeenCalled();
    expect(kept()).toEqual([[CONTENT_TYPE.PROCESSING_ERROR, expect.stringContaining('nothing is stored to send')]]);
  });

  it('queues a destination that always queues, without sending', async () => {
    expect(await redispatch('ALWAYS')).toMatchObject({ ok: true, value: 'QUEUED' });

    expect(store.enqueue).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 7, DESTINATION);
    expect(send).not.toHaveBeenCalled();
    expect(statuses()).toEqual([]);
  });

  describe.each([
    ['refuses it', ok({ status: 'ERROR', content: 'NAK body', errorMessage: 'refused' }), 'refused', 'NAK body'],
    ['refuses it without a reason', ok({ status: 'ERROR', content: 'NAK body' }), 'NAK body', 'NAK body'],
    ['refuses it with nothing at all', ok({ status: 'ERROR', content: '' }), 'The destination reported a failure without a reason', null],
    ['cannot be reached', fail('Connection refused'), 'Connection refused', null],
  ])('a partner that %s', (_how, result, reason, response) => {
    const expected = [...(response === null ? [] : [[CONTENT_TYPE.RESPONSE, response]]), [CONTENT_TYPE.ERROR, reason]];

    beforeEach(() => { send.mockResolvedValue(result); });

    it('ends the destination in ERROR with the reason, and alerts', async () => {
      expect(await redispatch('NEVER')).toMatchObject({ ok: true, value: 'ERROR' });

      expect(kept()).toEqual(expected);
      expect(onFailed).toHaveBeenCalledExactlyOnceWith(7, DESTINATION, null);
      expect(statuses()).toEqual([[7, DESTINATION, 'ERROR']]);
      expect(store.incrementStats).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, DESTINATION, 'server-01', 'errored');
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        channelId: CHANNEL_ID, errorType: 'DESTINATION_CONNECTOR', timestamp: expect.any(Number),
        errorMessage: `Crash recovery could not deliver message 7 to destination 2: ${reason}`,
      });
    });

    it('leaves it on the queue with the reason when the destination queues on failure', async () => {
      expect(await redispatch('ON_FAILURE')).toMatchObject({ ok: true, value: 'QUEUED' });

      expect(kept()).toEqual(expected);
      expect(store.enqueue).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 7, DESTINATION);
      expect(statuses()).toEqual([]);
      expect(store.incrementStats).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(onFailed).not.toHaveBeenCalled();
    });
  });

  describe('the channel stops', () => {
    it.each(['NEVER', 'ALWAYS'] as const)('before the send: the destination stays as it was under queue mode %s', async (queueMode) => {
      run.abort();

      expect((await redispatch(queueMode)).ok).toBe(false);

      expect(send).not.toHaveBeenCalled();
      expect(store.enqueue).not.toHaveBeenCalled();
      expect(statuses()).toEqual([]);
    });

    it.each(['NEVER', 'ON_FAILURE'] as const)('with a halt that ends the send: the destination stays as it was under queue mode %s', async (queueMode) => {
      send.mockImplementation((_d: number, _m: number, _c: string, signal: AbortSignal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve(fail('Send aborted')); });
      }));
      const done = redispatch(queueMode);
      await vi.waitFor(() => { expect(send).toHaveBeenCalledOnce(); });

      halt.abort();

      expect((await done).ok).toBe(false);
      expect(store.enqueue).not.toHaveBeenCalled();
      expect(statuses()).toEqual([]);
      expect(kept()).toEqual([]);
      expect(onError).not.toHaveBeenCalled();
    });

    it('with a halt, and the partner refuses it all the same: the refusal is kept', async () => {
      send.mockImplementation(async () => { halt.abort(); return ok({ status: 'ERROR', content: 'NAK' }); });

      expect(await redispatch()).toMatchObject({ ok: true, value: 'ERROR' });
      expect(kept()).toContainEqual([CONTENT_TYPE.ERROR, 'NAK']);
    });
  });

  describe('the store fails', () => {
    it.each([CONTENT_TYPE.SENT, CONTENT_TYPE.CHANNEL_MAP])('to read content type %i: the destination stays as it was', async (contentType) => {
      store.loadContent.mockImplementation(async (_c: string, _m: number, _d: number, type: number) => (type === contentType ? fail('db busy') : ok('payload')));

      expect(await redispatch()).toMatchObject({ ok: false, error: { message: 'db busy' } });

      expect(send).not.toHaveBeenCalled();
      expect(statuses()).toEqual([]);
    });

    it('to queue it: the destination stays as it was', async () => {
      store.enqueue.mockResolvedValue(fail('db busy'));
      expect(await redispatch('ALWAYS')).toMatchObject({ ok: false, error: { message: 'db busy' } });
    });

    it('to save the ERROR status: the destination stays as it was, uncounted and without an alert', async () => {
      send.mockResolvedValue(fail('Connection refused'));
      store.updateConnectorMessageStatus.mockResolvedValue(fail('db busy'));

      expect(await redispatch()).toMatchObject({ ok: false, error: { message: 'db busy' } });

      expect(store.incrementStats).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it.each([
      ['why', 'storeContent', 'why a destination failed'],
      ['the count', 'incrementStats', 'the count of a failed destination'],
    ] as const)('to save %s: it is reported, and the destination ends in ERROR', async (_what, write, what) => {
      send.mockResolvedValue(fail('Connection refused'));
      store[write].mockResolvedValue(fail('db busy'));

      expect(await redispatch()).toMatchObject({ ok: true, value: 'ERROR' });

      expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ what, errorMessage: 'db busy' }));
      expect(onError).toHaveBeenCalledOnce();
    });

    it('to save the response of a refusal: it is reported', async () => {
      send.mockResolvedValue(ok({ status: 'ERROR', content: 'NAK' }));
      store.storeContent.mockResolvedValueOnce(fail('db busy'));

      expect(await redispatch()).toMatchObject({ ok: true, value: 'ERROR' });

      expect(onStoreFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ what: 'the response of a failed destination' }));
    });
  });

  it('a send has 30 seconds', async () => {
    const expiry = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expiry.signal);
    try {
      send.mockImplementation((_d: number, _m: number, _c: string, signal: AbortSignal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve(fail('Send aborted')); });
      }));
      const done = redispatch();
      await vi.waitFor(() => { expect(send).toHaveBeenCalledOnce(); });
      expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
      expiry.abort();
      expect(await done).toMatchObject({ ok: true, value: 'ERROR' });
    } finally {
      timeout.mockRestore();
    }
  });
});
