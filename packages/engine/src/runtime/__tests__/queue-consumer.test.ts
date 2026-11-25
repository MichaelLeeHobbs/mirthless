import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { QueueConsumer } from '../queue-consumer.js';
import type { QueueConsumerConfig } from '../queue-consumer.js';
import type { MessageStore, SendToDestination, DestinationResponse } from '../../pipeline/message-processor.js';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function fail(message: string): Result<never> {
  return { ok: false, value: null, error: { message, code: 'ERROR' } } as unknown as Result<never>;
}

function makeConfig(overrides?: Partial<QueueConsumerConfig>): QueueConsumerConfig {
  return {
    channelId: '00000000-0000-0000-0000-000000000001',
    metaDataId: 1,
    serverId: 'server-01',
    retryCount: 3,
    retryIntervalMs: 100,
    batchSize: 5,
    pollIntervalMs: 100,
    ...overrides,
  };
}

function makeStore(): MessageStore {
  return {
    createMessage: vi.fn().mockResolvedValue(ok({ messageId: 1, correlationId: '00000000-0000-0000-0000-000000000099' })),
    createConnectorMessage: vi.fn().mockResolvedValue(ok(undefined)),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue(ok(undefined)),
    storeContent: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    enqueue: vi.fn().mockResolvedValue(ok(undefined)),
    // SENT content; no stored variables (content type 10) unless a test says so.
    loadContent: vi.fn().mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) => ok(contentType === 5 ? 'test content' : null)),
    incrementStats: vi.fn().mockResolvedValue(ok(undefined)),
    dequeue: vi.fn().mockResolvedValue(ok([])),
    release: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeSendFn(response?: DestinationResponse): SendToDestination {
  const resp = response ?? { status: 'SENT' as const, content: 'ACK' };
  return vi.fn().mockResolvedValue(ok(resp));
}

let consumer: QueueConsumer | null = null;

afterEach(async () => {
  if (consumer) {
    await consumer.stop();
    consumer = null;
  }
});

describe('QueueConsumer', () => {
  describe('poll', () => {
    it('dequeues and sends messages successfully', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      const queuedMsg = {
        channelId: '00000000-0000-0000-0000-000000000001',
        messageId: 10,
        metaDataId: 1,
        sendAttempts: 0,
      };
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queuedMsg]));

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(sendFn).toHaveBeenCalledOnce();
      expect(store.release).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 10, 1, 'SENT',
      );
      expect(store.incrementStats).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 1, 'server-01', 'sent',
      );
    });

    it('handles empty queue gracefully', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(sendFn).not.toHaveBeenCalled();
    });

    it('re-queues on send failure when retries remain', async () => {
      const store = makeStore();
      const sendFn: SendToDestination = vi.fn().mockResolvedValue(
        fail('Connection refused'),
      );
      const queuedMsg = {
        channelId: '00000000-0000-0000-0000-000000000001',
        messageId: 10,
        metaDataId: 1,
        sendAttempts: 0,
      };
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queuedMsg]));

      consumer = new QueueConsumer(makeConfig({ retryCount: 3 }), store, sendFn);
      await consumer.poll();

      // attempts 1 < retryCount 3
      expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 10, 1, 'QUEUED',
      );
      expect(store.release).not.toHaveBeenCalled();
    });

    it('releases as ERROR when retry count exceeded', async () => {
      const store = makeStore();
      const sendFn: SendToDestination = vi.fn().mockResolvedValue(
        fail('Still failing'),
      );
      const queuedMsg = {
        channelId: '00000000-0000-0000-0000-000000000001',
        messageId: 10,
        metaDataId: 1,
        sendAttempts: 3, // three retries already used, retryCount=3
      };
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queuedMsg]));

      consumer = new QueueConsumer(makeConfig({ retryCount: 3 }), store, sendFn);
      await consumer.poll();

      expect(store.release).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 10, 1, 'ERROR',
      );
      expect(store.incrementStats).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 1, 'server-01', 'errored',
      );
    });

    it('stores error content and raises an alert when it gives up on a message', async () => {
      const store = makeStore();
      const sendFn: SendToDestination = vi.fn().mockResolvedValue(fail('Connection refused'));
      const onError = vi.fn().mockResolvedValue(undefined);
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 11, metaDataId: 1, sendAttempts: 3 },
      ]));

      consumer = new QueueConsumer(makeConfig({ retryCount: 3, onError }), store, sendFn);
      await consumer.poll();

      expect(store.storeContent).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 11, 1, 11,
        'Delivery failed after 4 attempt(s): Connection refused', 'TEXT',
      );
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        channelId: '00000000-0000-0000-0000-000000000001',
        errorType: 'DESTINATION_CONNECTOR',
        errorMessage: expect.stringContaining('Connection refused') as unknown as string,
      }));
    });

    describe('when a persistence write fails', () => {
      const CH = '00000000-0000-0000-0000-000000000001';
      const queue = (store: MessageStore, sendAttempts: number): void => {
        (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
          { channelId: CH, messageId: 12, metaDataId: 1, sendAttempts },
        ]));
      };

      it('alerts and does not count a delivery whose SENT status was not saved', async () => {
        const store = makeStore();
        (store.release as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 0);

        consumer = new QueueConsumer(makeConfig({ onError }), store, makeSendFn());
        await consumer.poll();

        expect(store.incrementStats).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
          errorMessage: expect.stringMatching(/could not save SENT for message 12: db down.*PENDING/) as unknown as string,
        }));
      });

      it('alerts and does not count a give-up whose ERROR status was not saved', async () => {
        const store = makeStore();
        (store.release as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 3);

        consumer = new QueueConsumer(makeConfig({ retryCount: 3, onError }), store, vi.fn().mockResolvedValue(fail('refused')));
        await consumer.poll();

        expect(store.incrementStats).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
          errorMessage: expect.stringMatching(/could not save ERROR \(Delivery failed.*refused\).*db down/) as unknown as string,
        }));
      });

      const onStoreFailure = vi.fn();
      const reported = (): unknown[] => onStoreFailure.mock.calls.map((c: unknown[]) => c[0]);
      const failure = (what: string): unknown => ({ channelId: CH, messageId: 12, metaDataId: 1, what, errorMessage: 'db down' });
      const refuse = (write: 'storeContent' | 'incrementStats' | 'release' | 'updateConnectorMessageStatus'): MessageStore => {
        const store = makeStore();
        (store[write] as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));
        return store;
      };
      beforeEach(() => { onStoreFailure.mockReset(); });

      it('still ends as SENT when the answer was not saved, which is reported and alerted without it', async () => {
        const store = refuse('storeContent');
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 0);

        consumer = new QueueConsumer(makeConfig({ onError, onStoreFailure }), store, makeSendFn({ status: 'SENT', content: 'MRN-8675309' }));
        await consumer.poll();

        expect(store.release).toHaveBeenCalledExactlyOnceWith(CH, 12, 1, 'SENT');
        expect(reported()).toEqual([failure('the response of a delivered destination')]);
        expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          errorMessage: 'Queued destination 1 delivered message 12, but its response could not be saved: db down. A response the message shows is from an earlier attempt.',
        }));
      });

      it('alerts only that the message is sent again when neither its answer nor its SENT status was saved, and reports both', async () => {
        const store = refuse('storeContent');
        (store.release as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 0);

        consumer = new QueueConsumer(makeConfig({ onError, onStoreFailure }), store, makeSendFn());
        await consumer.poll();

        expect(reported()).toEqual([failure('the response of a delivered destination'), failure('the SENT status of a delivered destination')]);
        expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ errorMessage: expect.stringMatching(/could not save SENT.*PENDING/) as unknown as string }));
      });

      it('still ends as SENT when the count was not saved, which is reported, and tells the source', async () => {
        const store: MessageStore = { ...refuse('incrementStats'), isFullyDelivered: vi.fn().mockResolvedValue(ok(true)) };
        const onMessageDelivered = vi.fn().mockResolvedValue(undefined);
        queue(store, 0);
        (store.loadContent as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) => ok(contentType === 10 ? null : 'content'));

        consumer = new QueueConsumer(makeConfig({ onStoreFailure, onMessageDelivered }), store, makeSendFn());
        await consumer.poll();

        expect(store.release).toHaveBeenCalledExactlyOnceWith(CH, 12, 1, 'SENT');
        expect(reported()).toEqual([failure('the count of a delivered destination')]);
        expect(onMessageDelivered).toHaveBeenCalledExactlyOnceWith(12, 'content');
      });

      it('still ends as ERROR and alerts when the count of a give-up was not saved, which is reported', async () => {
        const store = refuse('incrementStats');
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 3);

        consumer = new QueueConsumer(makeConfig({ retryCount: 3, onError, onStoreFailure }), store, vi.fn().mockResolvedValue(fail('refused')));
        await consumer.poll();

        expect(store.release).toHaveBeenCalledExactlyOnceWith(CH, 12, 1, 'ERROR');
        expect(reported()).toEqual([failure('the count of a failed destination')]);
        expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ errorMessage: expect.stringContaining('gave up on message 12') as unknown as string }));
      });

      it('still ends as ERROR when the reason was not saved, which is reported, and the alert gives it', async () => {
        const store = refuse('storeContent');
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 3);

        consumer = new QueueConsumer(makeConfig({ retryCount: 3, onError, onStoreFailure }), store, vi.fn().mockResolvedValue(fail('refused')));
        await consumer.poll();

        expect(store.release).toHaveBeenCalledWith(CH, 12, 1, 'ERROR');
        expect(store.incrementStats).toHaveBeenCalledWith(CH, 1, 'server-01', 'errored');
        expect(reported()).toEqual([failure('why a destination failed')]);
        expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ errorMessage: expect.stringMatching(/gave up on message 12: .*refused/) as unknown as string }));
      });

      it('is retried when the reason of a failed attempt was not saved, which is reported', async () => {
        const store = refuse('storeContent');
        queue(store, 0);

        consumer = new QueueConsumer(makeConfig({ retryCount: 3, onStoreFailure }), store, vi.fn().mockResolvedValue(fail('refused')));
        await consumer.poll();

        expect(store.updateConnectorMessageStatus).toHaveBeenCalledExactlyOnceWith(CH, 12, 1, 'QUEUED');
        expect(reported()).toEqual([failure('why a destination failed')]);
      });

      it.each([
        ['the SENT status of a delivered destination', 'release', 0, ok({ status: 'SENT' as const, content: 'MRN-8675309' })],
        ['the ERROR status of a failed destination', 'release', 3, fail('partner said MRN-8675309')],
        ['the QUEUED status of a destination', 'updateConnectorMessageStatus', 0, fail('partner said MRN-8675309')],
      ] as const)('reports %s that was not saved, without what the partner said', async (what, write, sendAttempts, answer) => {
        const store = refuse(write);
        queue(store, sendAttempts);

        consumer = new QueueConsumer(makeConfig({ retryCount: 3, onStoreFailure }), store, vi.fn().mockResolvedValue(answer));
        await consumer.poll();

        expect(reported()).toEqual([failure(what)]);
      });

      it.each([
        ['removeContent', 'the removal of why an earlier attempt failed'],
        ['removeContentIfDelivered', 'the removal of the content of a completed message'],
      ] as const)('reports a %s that failed', async (removal, what) => {
        const store: MessageStore = { ...makeStore(), [removal]: vi.fn().mockResolvedValue(fail('db down')) };
        queue(store, 0);

        consumer = new QueueConsumer(makeConfig({ onStoreFailure }), store, makeSendFn());
        await consumer.poll();

        expect(reported()).toEqual([failure(what)]);
      });

      it('alerts when a retry could not be re-queued', async () => {
        const store = makeStore();
        (store.updateConnectorMessageStatus as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 0);

        consumer = new QueueConsumer(makeConfig({ retryCount: 3, onError }), store, vi.fn().mockResolvedValue(fail('refused')));
        await consumer.poll();

        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
          errorMessage: expect.stringContaining('could not save QUEUED for message 12: db down') as unknown as string,
        }));
      });
    });

    it('uses the remote error message when the destination answers but not SENT', async () => {
      const store = makeStore();
      const sendFn = makeSendFn({ status: 'ERROR', content: 'MSH|...|AE', errorMessage: 'Remote NAK (AE)' });
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 12, metaDataId: 1, sendAttempts: 1 },
      ]));

      consumer = new QueueConsumer(makeConfig({ retryCount: 1 }), store, sendFn);
      await consumer.poll();

      expect(store.storeContent).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 12, 1, 11,
        'Delivery failed after 2 attempt(s): Remote NAK (AE)', 'TEXT',
      );
      expect(store.release).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 12, 1, 'ERROR');
    });

    it('alerts once that a delivery failed and is being retried, and keeps the latest reason with the message', async () => {
      const store = makeStore();
      const onError = vi.fn().mockResolvedValue(undefined);
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 13, metaDataId: 1, sendAttempts: 0 },
      ]));

      consumer = new QueueConsumer(makeConfig({ retryCount: 3, retryIntervalMs: 0, onError }), store, vi.fn().mockResolvedValue(fail('x')));
      await consumer.poll();
      await consumer.poll();

      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        errorMessage: expect.stringMatching(/could not deliver message 13: x.*stays queued/) as unknown as string,
      }));
      expect(store.storeContent).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 13, 1, 11, 'x', 'TEXT');
      expect(store.updateConnectorMessageStatus).not.toHaveBeenCalledWith(expect.anything(), 13, 1, 'ERROR');
    });

    it('removes the reason an earlier attempt failed once a retry delivers (regression)', async () => {
      const store = { ...makeStore(), removeContent: vi.fn().mockResolvedValue(ok(undefined)) };
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 16, metaDataId: 1, sendAttempts: 0 },
      ]));
      const sendFn = vi.fn()
        .mockResolvedValueOnce(fail('HTTP 500'))
        .mockResolvedValueOnce(ok({ status: 'SENT', content: 'OK' }));

      consumer = new QueueConsumer(makeConfig({ retryCount: 3, retryIntervalMs: 0 }), store, sendFn);
      await consumer.poll();
      expect(store.removeContent).not.toHaveBeenCalled();
      await consumer.poll();

      expect(store.storeContent).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 16, 1, 11, 'HTTP 500', 'TEXT');
      expect(store.removeContent).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 16, 1, 11);
    });

    it('sends with the variables stored when the message was routed', async () => {
      const store = makeStore();
      (store.loadContent as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) =>
        ok(contentType === 5 ? 'test content' : '{"mrn":"MRN1"}'));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 14, metaDataId: 1, sendAttempts: 0 },
      ]));
      const sendFn = vi.fn().mockResolvedValue(ok({ status: 'SENT', content: '' }));

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(sendFn).toHaveBeenCalledWith(1, 14, 'test content', expect.any(AbortSignal), undefined, { mrn: 'MRN1' });
    });

    it('keeps a message queued when its stored variables cannot be read', async () => {
      const store = makeStore();
      (store.loadContent as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) =>
        (contentType === 5 ? ok('test content') : fail('connection lost')));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 15, metaDataId: 1, sendAttempts: 0 },
      ]));
      const sendFn = vi.fn();

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(sendFn).not.toHaveBeenCalled();
      expect(store.updateConnectorMessageStatus).not.toHaveBeenCalledWith(expect.anything(), 15, 1, 'ERROR');
    });

    it('alerts again for a new failure after a delivery succeeded', async () => {
      const store = makeStore();
      const onError = vi.fn().mockResolvedValue(undefined);
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 13, metaDataId: 1, sendAttempts: 0 },
      ]));
      const sendFn = vi.fn()
        .mockResolvedValueOnce(fail('down'))
        .mockResolvedValueOnce(ok({ status: 'SENT', content: 'ACK' }))
        .mockResolvedValueOnce(fail('down again'));

      consumer = new QueueConsumer(makeConfig({ retryIntervalMs: 0, onError }), store, sendFn);
      await consumer.poll();
      await consumer.poll();
      await consumer.poll();

      expect(onError).toHaveBeenCalledTimes(2);
    });

    it('counts retryCount as retries after the first attempt', async () => {
      const CH = '00000000-0000-0000-0000-000000000001';
      const attempt = async (retryCount: number, sendAttempts: number): Promise<MessageStore> => {
        const store = makeStore();
        (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([{ channelId: CH, messageId: 20, metaDataId: 1, sendAttempts }]));
        const c = new QueueConsumer(makeConfig({ retryCount }), store, vi.fn().mockResolvedValue(fail('x')));
        await c.poll();
        return store;
      };

      // retryCount 1: the first attempt and one retry are allowed.
      expect((await attempt(1, 0)).release).not.toHaveBeenCalledWith(CH, 20, 1, 'ERROR');
      expect((await attempt(1, 1)).release).toHaveBeenCalledWith(CH, 20, 1, 'ERROR');
      expect((await attempt(2, 1)).release).not.toHaveBeenCalledWith(CH, 20, 1, 'ERROR');
      expect((await attempt(2, 2)).release).toHaveBeenCalledWith(CH, 20, 1, 'ERROR');
    });

    it('never gives up when retryCount is 0', async () => {
      const store = makeStore();
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 21, metaDataId: 1, sendAttempts: 5_000 },
      ]));

      consumer = new QueueConsumer(makeConfig({ retryCount: 0 }), store, vi.fn().mockResolvedValue(fail('still down')));
      await consumer.poll();

      expect(store.release).not.toHaveBeenCalled();
      expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(expect.anything(), 21, 1, 'QUEUED');
    });

    it('puts a message back untouched when its content cannot be loaded right now', async () => {
      const CH = '00000000-0000-0000-0000-000000000001';
      const store = makeStore();
      const onError = vi.fn().mockResolvedValue(undefined);
      (store.loadContent as ReturnType<typeof vi.fn>).mockResolvedValue(fail('connection lost'));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: CH, messageId: 22, metaDataId: 1, sendAttempts: 0 },
        { channelId: CH, messageId: 23, metaDataId: 1, sendAttempts: 0 },
      ]));
      const sendFn = makeSendFn();

      consumer = new QueueConsumer(makeConfig({ onError }), store, sendFn);
      await consumer.poll();

      expect(sendFn).not.toHaveBeenCalled();
      expect(store.release).toHaveBeenCalledWith(CH, 22, 1, 'QUEUED');
      expect(store.release).toHaveBeenCalledWith(CH, 23, 1, 'QUEUED');
      expect(store.release).not.toHaveBeenCalledWith(CH, 22, 1, 'ERROR');
      expect(store.updateConnectorMessageStatus).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        errorMessage: expect.stringContaining('could not load message 22') as unknown as string,
      }));
    });

    describe('rotating queue', () => {
      const CH = '00000000-0000-0000-0000-000000000001';
      const q = (messageId: number): Record<string, unknown> => ({ channelId: CH, messageId, metaDataId: 1, sendAttempts: 0 });

      it('asks the store for least-attempted messages first', async () => {
        const store = makeStore();

        consumer = new QueueConsumer(makeConfig({ rotate: true }), store, makeSendFn());
        await consumer.poll();

        expect(store.dequeue).toHaveBeenCalledWith(CH, 1, 5, true);
      });

      it('still sends the messages behind one that fails', async () => {
        const store = makeStore();
        (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([q(1), q(2), q(3)])).mockResolvedValue(ok([]));
        const sendFn = vi.fn(async (_m: number, messageId: number) =>
          (messageId === 1 ? fail('poison') : ok({ status: 'SENT' as const, content: 'ACK' }))) as unknown as SendToDestination;

        consumer = new QueueConsumer(makeConfig({ rotate: true, retryIntervalMs: 60_000 }), store, sendFn);
        await consumer.poll();
        await consumer.poll();

        expect(store.release).toHaveBeenCalledWith(CH, 2, 1, 'SENT');
        expect(store.release).toHaveBeenCalledWith(CH, 3, 1, 'SENT');
        expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(CH, 1, 1, 'QUEUED');
        // Something was delivered, so the next poll runs straight away.
        expect(store.dequeue).toHaveBeenCalledTimes(2);
      });

      it('waits for the retry interval when nothing in the batch could be delivered', async () => {
        const store = makeStore();
        (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([q(1), q(2)]));

        consumer = new QueueConsumer(makeConfig({ rotate: true, retryIntervalMs: 60_000 }), store, vi.fn().mockResolvedValue(fail('down')));
        await consumer.poll();
        await consumer.poll();

        expect(store.dequeue).toHaveBeenCalledOnce();
      });
    });

    it('stores the destination response on a successful queued send', async () => {
      const store = makeStore();
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 14, metaDataId: 1, sendAttempts: 0 },
      ]));

      consumer = new QueueConsumer(makeConfig(), store, makeSendFn({ status: 'SENT', content: 'MSH|ACK' }));
      await consumer.poll();

      expect(store.storeContent).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 14, 1, 6, 'MSH|ACK', 'TEXT');
    });

    it('alerts when a queued message has no content to deliver', async () => {
      const store = makeStore();
      const onError = vi.fn().mockResolvedValue(undefined);
      (store.loadContent as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 15, metaDataId: 1, sendAttempts: 0 },
      ]));

      consumer = new QueueConsumer(makeConfig({ onError }), store, makeSendFn());
      await consumer.poll();

      expect(onError).toHaveBeenCalledOnce();
      expect(store.release).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 15, 1, 'ERROR');
    });

    it('calls loadContent before sending', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      const queuedMsg = {
        channelId: '00000000-0000-0000-0000-000000000001',
        messageId: 10,
        metaDataId: 1,
        sendAttempts: 0,
      };
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queuedMsg]));

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(store.loadContent).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 10, 1, 5,
      );
      expect(sendFn).toHaveBeenCalledWith(1, 10, 'test content', expect.any(AbortSignal), undefined, undefined);
    });

    it('releases as ERROR when loadContent returns null', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      const queuedMsg = {
        channelId: '00000000-0000-0000-0000-000000000001',
        messageId: 10,
        metaDataId: 1,
        sendAttempts: 0,
      };
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queuedMsg]));
      (store.loadContent as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(sendFn).not.toHaveBeenCalled();
      expect(store.release).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001', 10, 1, 'ERROR',
      );
    });

    it('handles dequeue failure gracefully', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(fail('DB error'));

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(sendFn).not.toHaveBeenCalled();
    });

    it('processes multiple messages in a batch', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      const msgs = [
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 10, metaDataId: 1, sendAttempts: 0 },
        { channelId: '00000000-0000-0000-0000-000000000001', messageId: 11, metaDataId: 1, sendAttempts: 0 },
      ];
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok(msgs));

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      await consumer.poll();

      expect(sendFn).toHaveBeenCalledTimes(2);
      expect(store.release).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry interval and ordering', () => {
    const CH = '00000000-0000-0000-0000-000000000001';
    const queued = (messageId: number, sendAttempts = 0): Record<string, unknown> =>
      ({ channelId: CH, messageId, metaDataId: 1, sendAttempts });

    afterEach(() => { vi.useRealTimers(); });

    it('waits the retry interval before trying a failed message again', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      const store = makeStore();
      const sendFn: SendToDestination = vi.fn().mockResolvedValue(fail('Connection refused'));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued(10)]));
      consumer = new QueueConsumer(makeConfig({ retryIntervalMs: 10_000 }), store, sendFn);

      await consumer.poll();
      expect(sendFn).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_000_000 + 9_999);
      await consumer.poll();
      expect(sendFn).toHaveBeenCalledTimes(1);
      expect(store.dequeue).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_000_000 + 10_000);
      await consumer.poll();
      expect(sendFn).toHaveBeenCalledTimes(2);
    });

    it('does not wait after a successful send', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued(10)]));
      consumer = new QueueConsumer(makeConfig({ retryIntervalMs: 10_000 }), store, sendFn);

      await consumer.poll();
      await consumer.poll();

      expect(sendFn).toHaveBeenCalledTimes(2);
    });

    it('sends a batch in message order whatever order the store returns', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued(12), queued(10), queued(11)]));
      consumer = new QueueConsumer(makeConfig(), store, sendFn);

      await consumer.poll();

      const sentIds = (sendFn as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1]);
      expect(sentIds).toEqual([10, 11, 12]);
    });

    it('holds later messages behind a failed one so delivery stays in order', async () => {
      const store = makeStore();
      const sendFn: SendToDestination = vi.fn().mockResolvedValue(fail('Connection refused'));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued(10), queued(11), queued(12)]));
      consumer = new QueueConsumer(makeConfig(), store, sendFn);

      await consumer.poll();

      expect(sendFn).toHaveBeenCalledTimes(1);
      // The failed message counts an attempt; the ones behind it do not.
      expect(store.updateConnectorMessageStatus).toHaveBeenCalledTimes(1);
      expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(CH, 10, 1, 'QUEUED');
      expect(store.release).toHaveBeenCalledWith(CH, 11, 1, 'QUEUED');
      expect(store.release).toHaveBeenCalledWith(CH, 12, 1, 'QUEUED');
    });

    it('moves on to the next message once it gives up on one', async () => {
      const store = makeStore();
      const sendFn: SendToDestination = vi.fn()
        .mockResolvedValueOnce(fail('bad message'))
        .mockResolvedValue(ok({ status: 'SENT', content: 'ACK' }));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued(10, 3), queued(11)]));
      consumer = new QueueConsumer(makeConfig({ retryCount: 3 }), store, sendFn);

      await consumer.poll();

      expect(store.release).toHaveBeenCalledWith(CH, 10, 1, 'ERROR');
      expect(store.release).toHaveBeenCalledWith(CH, 11, 1, 'SENT');
    });

    it('alerts when a held message could not be put back on the queue', async () => {
      const store = makeStore();
      const onError = vi.fn().mockResolvedValue(undefined);
      const sendFn: SendToDestination = vi.fn().mockResolvedValue(fail('Connection refused'));
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued(10), queued(11)]));
      (store.release as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));
      consumer = new QueueConsumer(makeConfig({ onError }), store, sendFn);

      await consumer.poll();

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        errorMessage: expect.stringContaining('could not save QUEUED for message 11'),
      }));
    });

    it('alerts once when the queue cannot be read, and again only after it recovers', async () => {
      const store = makeStore();
      const onError = vi.fn().mockResolvedValue(undefined);
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));
      consumer = new QueueConsumer(makeConfig({ onError }), store, makeSendFn());

      await consumer.poll();
      await consumer.poll();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        errorMessage: expect.stringContaining('could not read its queue: db down'),
      }));

      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok([]));
      await consumer.poll();
      await consumer.poll();
      expect(onError).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    const CH = '00000000-0000-0000-0000-000000000001';

    it('waits for the send in flight before it resolves', async () => {
      vi.useFakeTimers();
      const store = makeStore();
      let finishSend!: (r: Result<DestinationResponse>) => void;
      const sendFn: SendToDestination = vi.fn().mockReturnValue(
        new Promise<Result<DestinationResponse>>((resolve) => { finishSend = resolve; }),
      );
      (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok([{ channelId: CH, messageId: 10, metaDataId: 1, sendAttempts: 0 }, { channelId: CH, messageId: 11, metaDataId: 1, sendAttempts: 0 }]),
      );
      const local = new QueueConsumer(makeConfig(), store, sendFn);
      local.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(sendFn).toHaveBeenCalledTimes(1);

      let stopped = false;
      const stopping = local.stop().then(() => { stopped = true; });
      await vi.advanceTimersByTimeAsync(50);
      expect(stopped).toBe(false);

      finishSend(ok({ status: 'SENT', content: 'ACK' }));
      await stopping;
      vi.useRealTimers();

      expect(store.release).toHaveBeenCalledWith(CH, 10, 1, 'SENT');
      expect(store.release).toHaveBeenCalledWith(CH, 11, 1, 'QUEUED');
      expect(sendFn).toHaveBeenCalledTimes(1);
    });

    it('a halt ends the send in flight and puts its message back without counting an attempt or raising an alert', async () => {
      const store = makeStore();
      (store.dequeue as Mock).mockResolvedValueOnce(ok([
        { channelId: 'ch', messageId: 10, metaDataId: 1, sendAttempts: 2 },
        { channelId: 'ch', messageId: 11, metaDataId: 1, sendAttempts: 0 },
      ]));
      let sending = (): void => undefined;
      const inFlight = new Promise<void>((resolve) => { sending = resolve; });
      const sendFn = vi.fn((...[, , , signal]: Parameters<SendToDestination>) => new Promise<Result<DestinationResponse>>((resolve) => {
        signal.addEventListener('abort', () => { resolve(fail('Send aborted')); });
        sending();
      }));
      const onError = vi.fn().mockResolvedValue(undefined);
      consumer = new QueueConsumer(makeConfig({ retryCount: 2, pollIntervalMs: 1, onError }), store, sendFn);
      consumer.start();
      await inFlight;

      await consumer.halt();

      expect(sendFn).toHaveBeenCalledOnce();
      expect((store.release as Mock).mock.calls.map((c: unknown[]) => c.slice(1))).toEqual([[10, 1, 'QUEUED'], [11, 1, 'QUEUED']]);
      expect(store.updateConnectorMessageStatus).not.toHaveBeenCalled();
      expect(store.storeContent).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('a halt with rotate puts back the message in flight and those behind it', async () => {
      const store = makeStore();
      (store.dequeue as Mock).mockResolvedValueOnce(ok([
        { channelId: 'ch', messageId: 10, metaDataId: 1, sendAttempts: 0 },
        { channelId: 'ch', messageId: 11, metaDataId: 1, sendAttempts: 0 },
      ]));
      let sending = (): void => undefined;
      const inFlight = new Promise<void>((resolve) => { sending = resolve; });
      const sendFn = vi.fn((...[, , , signal]: Parameters<SendToDestination>) => new Promise<Result<DestinationResponse>>((resolve) => {
        signal.addEventListener('abort', () => { resolve(fail('Send aborted')); });
        sending();
      }));
      consumer = new QueueConsumer(makeConfig({ rotate: true, pollIntervalMs: 1 }), store, sendFn);
      consumer.start();
      await inFlight;

      await consumer.halt();

      expect(sendFn).toHaveBeenCalledOnce();
      expect((store.release as Mock).mock.calls.map((c: unknown[]) => c.slice(1))).toEqual([[10, 1, 'QUEUED'], [11, 1, 'QUEUED']]);
    });

    it.each([
      ['a refusal that comes as the channel is halted', 'halt', ok({ status: 'ERROR' as const, content: 'NAK', errorMessage: 'refused' }), 'refused'],
      ['a failure that comes as the channel is stopped', 'stop', fail('Connection refused'), 'Connection refused'],
    ] as const)('%s counts as an attempt', async (_what, action, result, reason) => {
      const store = makeStore();
      (store.dequeue as Mock).mockResolvedValueOnce(ok([{ channelId: 'ch', messageId: 10, metaDataId: 1, sendAttempts: 0 }]));
      let answer = (): void => undefined;
      const sendFn = vi.fn(() => new Promise<Result<DestinationResponse>>((resolve) => { answer = (): void => { resolve(result); }; }));
      const onError = vi.fn().mockResolvedValue(undefined);
      consumer = new QueueConsumer(makeConfig({ pollIntervalMs: 1, onError }), store, sendFn);
      consumer.start();
      await vi.waitFor(() => { expect(sendFn).toHaveBeenCalledOnce(); });

      const ended = consumer[action]();
      answer();
      await ended;

      expect(store.updateConnectorMessageStatus).toHaveBeenCalledExactlyOnceWith(expect.anything(), 10, 1, 'QUEUED');
      expect((store.storeContent as Mock).mock.calls.map((c: unknown[]) => c[4])).toEqual([reason]);
      expect(onError).toHaveBeenCalledOnce();
      expect(store.release).not.toHaveBeenCalled();
    });

    it('sends at once again after a halt and a start, however long the retry interval', async () => {
      const store = makeStore();
      (store.dequeue as Mock).mockResolvedValue(ok([{ channelId: 'ch', messageId: 10, metaDataId: 1, sendAttempts: 0 }]));
      const sendFn = vi.fn((...[, , , signal]: Parameters<SendToDestination>) => new Promise<Result<DestinationResponse>>((resolve) => {
        signal.addEventListener('abort', () => { resolve(fail('Send aborted')); });
      }));
      consumer = new QueueConsumer(makeConfig({ pollIntervalMs: 1, retryIntervalMs: 60_000 }), store, sendFn);
      consumer.start();
      await vi.waitFor(() => { expect(sendFn).toHaveBeenCalledOnce(); });
      await consumer.halt();

      consumer.start();

      await vi.waitFor(() => { expect(sendFn).toHaveBeenCalledTimes(2); });
      await consumer.halt();
    });

    it('a halt keeps the delivery of a send that had gone through', async () => {
      const store = makeStore();
      (store.dequeue as Mock).mockResolvedValueOnce(ok([{ channelId: 'ch', messageId: 10, metaDataId: 1, sendAttempts: 0 }]));
      let sending = (): void => undefined;
      const inFlight = new Promise<void>((resolve) => { sending = resolve; });
      const sendFn = vi.fn((...[, , , signal]: Parameters<SendToDestination>) => new Promise<Result<DestinationResponse>>((resolve) => {
        signal.addEventListener('abort', () => { resolve(ok({ status: 'SENT' as const, content: 'ACK' })); });
        sending();
      }));
      consumer = new QueueConsumer(makeConfig({ pollIntervalMs: 1 }), store, sendFn);
      consumer.start();
      await inFlight;

      await consumer.halt();

      expect((store.release as Mock).mock.calls.map((c: unknown[]) => c.slice(1))).toEqual([[10, 1, 'SENT']]);
    });

    it('gives a send 30 seconds', async () => {
      const store = makeStore();
      (store.dequeue as Mock).mockResolvedValueOnce(ok([{ channelId: 'ch', messageId: 10, metaDataId: 1, sendAttempts: 0 }]));
      const expiry = new AbortController();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expiry.signal);
      try {
        const sendFn = vi.fn(async (...[, , , signal]: Parameters<SendToDestination>) => {
          expiry.abort();
          return fail(signal.aborted ? 'expired' : 'still going');
        });
        consumer = new QueueConsumer(makeConfig(), store, sendFn);
        await consumer.poll();
        expect(timeout).toHaveBeenCalledWith(30_000);
      } finally {
        timeout.mockRestore();
      }
      expect((store.storeContent as Mock).mock.calls.map((c: unknown[]) => c[4])).toEqual(['expired']);
    });

    it('a stop does not end the send in flight, and a start after a halt sends again', async () => {
      const store = makeStore();
      (store.dequeue as Mock).mockResolvedValue(ok([{ channelId: 'ch', messageId: 10, metaDataId: 1, sendAttempts: 0 }]));
      const signals: AbortSignal[] = [];
      let answer = (): void => undefined;
      const sendFn = vi.fn((...[, , , signal]: Parameters<SendToDestination>) => new Promise<Result<DestinationResponse>>((resolve) => {
        signals.push(signal);
        answer = (): void => { resolve(ok({ status: 'SENT' as const, content: 'ACK' })); };
      }));
      consumer = new QueueConsumer(makeConfig({ pollIntervalMs: 1 }), store, sendFn);
      consumer.start();
      await vi.waitFor(() => { expect(signals).toHaveLength(1); });
      const stopped = consumer.stop();
      expect(signals[0]?.aborted).toBe(false);
      answer();
      await stopped;

      await consumer.halt();
      consumer.start();
      await vi.waitFor(() => { expect(signals).toHaveLength(2); });
      expect(signals[1]?.aborted).toBe(false);
      answer();
    });

    it('does not poll again after stop', async () => {
      vi.useFakeTimers();
      const store = makeStore();
      const local = new QueueConsumer(makeConfig(), store, makeSendFn());
      local.start();
      await vi.advanceTimersByTimeAsync(100);
      await local.stop();
      const polls = (store.dequeue as ReturnType<typeof vi.fn>).mock.calls.length;

      await vi.advanceTimersByTimeAsync(1_000);
      vi.useRealTimers();

      expect((store.dequeue as ReturnType<typeof vi.fn>).mock.calls.length).toBe(polls);
    });

    it('keeps polling after a poll throws, and raises an alert', async () => {
      vi.useFakeTimers();
      const store = makeStore();
      const onError = vi.fn().mockResolvedValue(undefined);
      (store.dequeue as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(ok([]));
      const local = new QueueConsumer(makeConfig({ onError }), store, makeSendFn());
      local.start();

      await vi.advanceTimersByTimeAsync(250);
      await local.stop();
      vi.useRealTimers();

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('boom') }));
      expect((store.dequeue as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('start/stop', () => {
    it('starts and stops without error', async () => {
      const store = makeStore();
      const sendFn = makeSendFn();

      consumer = new QueueConsumer(makeConfig(), store, sendFn);
      consumer.start();

      // Let one poll cycle happen
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      await consumer.stop();
      consumer = null;
    });
  });
});

describe('QueueConsumer content removal', () => {
  const CH = '00000000-0000-0000-0000-000000000001';
  const queued = { channelId: CH, messageId: 10, metaDataId: 1, sendAttempts: 0 };

  type Removal = NonNullable<MessageStore['removeContentIfDelivered']>;

  function storeWith(removal: Mock<Removal>): MessageStore {
    const store = { ...makeStore(), removeContentIfDelivered: removal };
    (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued]));
    return store;
  }

  it('asks the store to apply the removal policy once a queued message is delivered', async () => {
    const removal = vi.fn<Removal>().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);

    consumer = new QueueConsumer(makeConfig(), store, makeSendFn());
    await consumer.poll();

    expect(store.release).toHaveBeenCalledWith(CH, 10, 1, 'SENT');
    expect(removal).toHaveBeenCalledWith(CH, 10);
  });

  it('keeps the content when the delivery fails and will be retried', async () => {
    const removal = vi.fn<Removal>().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);

    consumer = new QueueConsumer(makeConfig(), store, makeSendFn({ status: 'ERROR', content: '', errorMessage: 'down' }));
    await consumer.poll();

    expect(removal).not.toHaveBeenCalled();
  });

  it('keeps the content when the queue gives up, so the failure can be investigated', async () => {
    const removal = vi.fn<Removal>().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);

    (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([{ ...queued, sendAttempts: 1 }]));
    consumer = new QueueConsumer(makeConfig({ retryCount: 1 }), store, makeSendFn({ status: 'ERROR', content: '', errorMessage: 'down' }));
    await consumer.poll();

    expect(store.release).toHaveBeenCalledWith(CH, 10, 1, 'ERROR');
    expect(removal).not.toHaveBeenCalled();
  });

  it('keeps the content when SENT could not be saved (the message is delivered again)', async () => {
    const removal = vi.fn<Removal>().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);
    (store.release as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));

    consumer = new QueueConsumer(makeConfig(), store, makeSendFn());
    await consumer.poll();

    expect(removal).not.toHaveBeenCalled();
  });

  it('raises an alert when the removal itself fails', async () => {
    const removal = vi.fn<Removal>().mockResolvedValue(fail('delete failed'));
    const store = storeWith(removal);
    const onError = vi.fn().mockResolvedValue(undefined);

    consumer = new QueueConsumer(makeConfig({ onError }), store, makeSendFn());
    await consumer.poll();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: expect.stringContaining('delete failed'),
    }));
  });
});

// ----- Telling the source a queued message is delivered (#243) -----

describe('QueueConsumer onMessageDelivered', () => {
  const CH = '00000000-0000-0000-0000-000000000001';
  const queued = { channelId: CH, messageId: 10, metaDataId: 1, sendAttempts: 0 };
  type Delivered = NonNullable<MessageStore['isFullyDelivered']>;
  type Hook = NonNullable<QueueConsumerConfig['onMessageDelivered']>;

  function storeWith(delivered: Mock<Delivered>, raw: Result<string | null> = ok('/dicom/in/1.2.3.dcm')): MessageStore {
    const store = { ...makeStore(), isFullyDelivered: delivered };
    (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued]));
    (store.loadContent as ReturnType<typeof vi.fn>).mockImplementation(
      async (_c: string, _m: number, metaDataId: number, contentType: number) => {
        if (metaDataId === 0 && contentType === 1) return raw;
        return ok(contentType === 5 ? 'test content' : null);
      },
    );
    return store;
  }

  it('passes the raw content to the source once the delivery leaves the whole message delivered', async () => {
    const hook = vi.fn<Hook>().mockResolvedValue(undefined);
    const store = storeWith(vi.fn<Delivered>().mockResolvedValue(ok(true)));

    consumer = new QueueConsumer(makeConfig({ onMessageDelivered: hook }), store, makeSendFn());
    await consumer.poll();

    expect(store.isFullyDelivered).toHaveBeenCalledWith(CH, 10);
    expect(hook).toHaveBeenCalledWith(10, '/dicom/in/1.2.3.dcm');
  });

  it('runs before the content is removed, so the raw content is still there', async () => {
    const order: string[] = [];
    const hook = vi.fn<Hook>().mockImplementation(async () => { order.push('hook'); });
    const store = {
      ...storeWith(vi.fn<Delivered>().mockResolvedValue(ok(true))),
      removeContentIfDelivered: vi.fn().mockImplementation(async () => { order.push('remove'); return ok(undefined); }),
    };

    consumer = new QueueConsumer(makeConfig({ onMessageDelivered: hook }), store, makeSendFn());
    await consumer.poll();

    expect(order).toEqual(['hook', 'remove']);
  });

  it('does not call the source while another connector of the message is unfinished', async () => {
    const hook = vi.fn<Hook>().mockResolvedValue(undefined);
    const store = storeWith(vi.fn<Delivered>().mockResolvedValue(ok(false)));

    consumer = new QueueConsumer(makeConfig({ onMessageDelivered: hook }), store, makeSendFn());
    await consumer.poll();

    expect(hook).not.toHaveBeenCalled();
  });

  it('does not call the source when the delivery fails', async () => {
    const hook = vi.fn<Hook>().mockResolvedValue(undefined);
    const store = storeWith(vi.fn<Delivered>().mockResolvedValue(ok(true)));

    consumer = new QueueConsumer(makeConfig({ onMessageDelivered: hook }), store, makeSendFn({ status: 'ERROR', content: '', errorMessage: 'down' }));
    await consumer.poll();

    expect(hook).not.toHaveBeenCalled();
  });

  // The pipeline saw the message finished too, ran the source's action itself
  // and removed the content on completion (#320 review).
  it('does nothing when the raw content is already gone', async () => {
    const hook = vi.fn<Hook>().mockResolvedValue(undefined);
    const onError = vi.fn().mockResolvedValue(undefined);
    const store = storeWith(vi.fn<Delivered>().mockResolvedValue(ok(true)), ok(null));

    consumer = new QueueConsumer(makeConfig({ onMessageDelivered: hook, onError }), store, makeSendFn());
    await consumer.poll();

    expect(hook).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ['the state cannot be read', fail('db down'), ok('/x.dcm'), 'db down'],
    ['the raw content cannot be read', ok(true), fail('read failed'), 'read failed'],
  ] as const)('raises an alert instead of calling the source when %s', async (_case, delivered, raw, text) => {
    const hook = vi.fn<Hook>().mockResolvedValue(undefined);
    const onError = vi.fn().mockResolvedValue(undefined);
    const store = storeWith(vi.fn<Delivered>().mockResolvedValue(delivered as Result<boolean>), raw as Result<string | null>);

    consumer = new QueueConsumer(makeConfig({ onMessageDelivered: hook, onError }), store, makeSendFn());
    await consumer.poll();

    expect(hook).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining(text) }));
  });

  it('raises an alert when the source throws', async () => {
    const hook = vi.fn<Hook>().mockRejectedValue(new Error('rename failed'));
    const onError = vi.fn().mockResolvedValue(undefined);
    const store = storeWith(vi.fn<Delivered>().mockResolvedValue(ok(true)));

    consumer = new QueueConsumer(makeConfig({ onMessageDelivered: hook, onError }), store, makeSendFn());
    await consumer.poll();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('rename failed') }));
  });
});
