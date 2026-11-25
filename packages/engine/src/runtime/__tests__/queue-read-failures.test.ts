// A queue that cannot be read is told in the log too: on a channel without an alert nothing else says that it stands still (#417).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { QueueConsumer, type QueueReadFailure } from '../queue-consumer.js';
import type { MessageStore } from '../../pipeline/message-processor.js';

const CHANNEL = '00000000-0000-0000-0000-000000000001';
const MESSAGE = { channelId: CHANNEL, messageId: 10, metaDataId: 1, sendAttempts: 0 };

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function fail(message: string): Result<never> {
  return { ok: false, value: null, error: new Error(message) } as unknown as Result<never>;
}

function makeStore(overrides: Partial<MessageStore>): MessageStore {
  const done = async (): Promise<Result<void>> => ok(undefined);
  return {
    createMessage: async () => ok({ messageId: 1, correlationId: '' }),
    createConnectorMessage: done, updateConnectorMessageStatus: done, storeContent: done,
    markProcessed: done, enqueue: done, incrementStats: done, release: done,
    loadContent: async (_channel, _message, _destination, type) => ok(type === CONTENT_TYPE.CHANNEL_MAP ? null : 'content'),
    dequeue: async () => ok([MESSAGE]),
    ...overrides,
  };
}

let failures: QueueReadFailure[];

function consumerOf(overrides: Partial<MessageStore>): QueueConsumer {
  return new QueueConsumer(
    {
      channelId: CHANNEL, metaDataId: 1, serverId: 'server-01', retryCount: 0, retryIntervalMs: 10_000, batchSize: 5, pollIntervalMs: 1_000,
      onReadFailure: (failure) => { failures.push(failure); },
      onMessageDelivered: async () => undefined,
    },
    makeStore(overrides),
    async () => ok({ status: 'SENT' as const, content: 'ACK' }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  failures = [];
});

afterEach(() => { vi.useRealTimers(); });

describe('a queue that cannot be read', () => {
  it('is reported at once, and again each minute while it lasts', async () => {
    const consumer = consumerOf({ dequeue: async () => fail('db down') });

    for (let second = 0; second < 121; second++) {
      await consumer.poll();
      vi.advanceTimersByTime(1_000);
    }

    expect(failures).toHaveLength(3);
    expect(failures[0]).toEqual({
      channelId: CHANNEL, metaDataId: 1, messageId: undefined,
      errorMessage: 'Queued destination 1 could not read its queue: db down',
    });
  });

  it('is reported when the poll throws', async () => {
    const consumer = consumerOf({ dequeue: async () => { throw new Error('pool closed'); } });

    consumer.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await consumer.stop();

    expect(failures.map((f) => f.errorMessage)).toEqual(['Queued destination 1 poll failed: pool closed']);
  });
});

describe('a queued message that cannot be read', () => {
  it.each([
    ['content', CONTENT_TYPE.SENT, 'could not load message 10 to deliver it: db down'],
    ['variables', CONTENT_TYPE.CHANNEL_MAP, 'could not load the variables of message 10: db down'],
  ])('is reported with its number when its %s cannot be loaded', async (_what, unreadable, text) => {
    const consumer = consumerOf({
      loadContent: async (_channel, _message, _destination, type) => (type === unreadable ? fail('db down') : ok('content')),
    });

    await consumer.poll();

    expect(failures).toEqual([expect.objectContaining({ messageId: 10, errorMessage: expect.stringContaining(text) as string })]);
  });

  it('is reported at most once a minute while it is retried', async () => {
    const consumer = consumerOf({ loadContent: async () => fail('db down') });

    for (let retry = 0; retry < 7; retry++) {
      await consumer.poll();
      vi.advanceTimersByTime(10_000);
    }

    expect(failures).toHaveLength(2);
  });
});

describe("a delivered message whose source's action did not run", () => {
  it.each([
    ['its state cannot be read', { isFullyDelivered: async () => fail('db down') }, "did not run: the message's state could not be read: db down"],
    ['its raw content cannot be read', {
      isFullyDelivered: async () => ok(true),
      loadContent: async (_c: string, _m: number, metaDataId: number, type: number) => (metaDataId === 0 ? fail('read failed') : ok(type === CONTENT_TYPE.CHANNEL_MAP ? null : 'content')),
    }, 'did not run: read failed'],
  ] as const)('is reported each time when %s', async (_case, overrides, text) => {
    const consumer = consumerOf({ ...overrides, dequeue: async () => ok([MESSAGE, { ...MESSAGE, messageId: 11 }]) });

    await consumer.poll();

    expect(failures.map((f) => f.messageId)).toEqual([10, 11]);
    expect(failures[0]?.errorMessage).toContain(text);
  });
});
