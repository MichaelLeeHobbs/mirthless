// ===========================================
// Queue Consumer Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Result } from '@mirthless/core-util';
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
    createMessage: vi.fn().mockResolvedValue(ok({ messageId: 1 })),
    createConnectorMessage: vi.fn().mockResolvedValue(ok(undefined)),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue(ok(undefined)),
    storeContent: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    enqueue: vi.fn().mockResolvedValue(ok(undefined)),
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
        sendAttempts: 2, // Already tried twice, retryCount=3
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
