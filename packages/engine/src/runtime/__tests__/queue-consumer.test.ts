// ===========================================
// Queue Consumer Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import { QueueConsumer } from '../queue-consumer.js';
import type { QueueConsumerConfig } from '../queue-consumer.js';
import type { MessageStore, SendToDestination, DestinationResponse } from '../../pipeline/message-processor.js';

// ----- Helpers -----

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
    loadContent: vi.fn().mockResolvedValue(ok('test content')),
    incrementStats: vi.fn().mockResolvedValue(ok(undefined)),
    dequeue: vi.fn().mockResolvedValue(ok([])),
    release: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeSendFn(response?: DestinationResponse): SendToDestination {
  const resp = response ?? { status: 'SENT' as const, content: 'ACK' };
  return vi.fn().mockResolvedValue(ok(resp));
}

// ----- Tests -----

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

      // Should re-queue, not release as ERROR (attempts=1 < retryCount=3)
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

      it('still finalizes as ERROR but alerts when the error reason was not saved', async () => {
        const store = makeStore();
        (store.storeContent as ReturnType<typeof vi.fn>).mockResolvedValue(fail('disk full'));
        const onError = vi.fn().mockResolvedValue(undefined);
        queue(store, 3);

        consumer = new QueueConsumer(makeConfig({ retryCount: 3, onError }), store, vi.fn().mockResolvedValue(fail('refused')));
        await consumer.poll();

        expect(store.release).toHaveBeenCalledWith(CH, 12, 1, 'ERROR');
        expect(store.incrementStats).toHaveBeenCalledWith(CH, 1, 'server-01', 'errored');
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
          errorMessage: expect.stringContaining('could not save the error reason for message 12: disk full') as unknown as string,
        }));
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

    it('alerts once that a delivery failed and is being retried, and stores no error', async () => {
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
      expect(store.storeContent).not.toHaveBeenCalled();
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
      // retryCount 2: two retries.
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
      expect(sendFn).toHaveBeenCalledWith(1, 10, 'test content', expect.any(AbortSignal));
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

      // The message in flight is finished; the one behind it goes back on the queue unsent.
      expect(store.release).toHaveBeenCalledWith(CH, 10, 1, 'SENT');
      expect(store.release).toHaveBeenCalledWith(CH, 11, 1, 'QUEUED');
      expect(sendFn).toHaveBeenCalledTimes(1);
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

// ----- Content removal after a queued delivery -----

describe('QueueConsumer content removal', () => {
  const CH = '00000000-0000-0000-0000-000000000001';
  const queued = { channelId: CH, messageId: 10, metaDataId: 1, sendAttempts: 0 };

  function storeWith(removal: ReturnType<typeof vi.fn>): MessageStore {
    const store = { ...makeStore(), removeContentIfDelivered: removal };
    (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([queued]));
    return store;
  }

  it('asks the store to apply the removal policy once a queued message is delivered', async () => {
    const removal = vi.fn().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);

    consumer = new QueueConsumer(makeConfig(), store, makeSendFn());
    await consumer.poll();

    expect(store.release).toHaveBeenCalledWith(CH, 10, 1, 'SENT');
    expect(removal).toHaveBeenCalledWith(CH, 10);
  });

  it('keeps the content when the delivery fails and will be retried', async () => {
    const removal = vi.fn().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);

    consumer = new QueueConsumer(makeConfig(), store, makeSendFn({ status: 'ERROR', content: '', errorMessage: 'down' }));
    await consumer.poll();

    expect(removal).not.toHaveBeenCalled();
  });

  it('keeps the content when the queue gives up, so the failure can be investigated', async () => {
    const removal = vi.fn().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);

    (store.dequeue as ReturnType<typeof vi.fn>).mockResolvedValue(ok([{ ...queued, sendAttempts: 1 }]));
    consumer = new QueueConsumer(makeConfig({ retryCount: 1 }), store, makeSendFn({ status: 'ERROR', content: '', errorMessage: 'down' }));
    await consumer.poll();

    expect(store.release).toHaveBeenCalledWith(CH, 10, 1, 'ERROR');
    expect(removal).not.toHaveBeenCalled();
  });

  it('keeps the content when SENT could not be saved (the message is delivered again)', async () => {
    const removal = vi.fn().mockResolvedValue(ok(undefined));
    const store = storeWith(removal);
    (store.release as ReturnType<typeof vi.fn>).mockResolvedValue(fail('db down'));

    consumer = new QueueConsumer(makeConfig(), store, makeSendFn());
    await consumer.poll();

    expect(removal).not.toHaveBeenCalled();
  });

  it('raises an alert when the removal itself fails', async () => {
    const removal = vi.fn().mockResolvedValue(fail('delete failed'));
    const store = storeWith(removal);
    const onError = vi.fn().mockResolvedValue(undefined);

    consumer = new QueueConsumer(makeConfig({ onError }), store, makeSendFn());
    await consumer.poll();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: expect.stringContaining('delete failed'),
    }));
  });
});
