// ===========================================
// Fake Kafka topic for unit tests
// ===========================================
// One partition and one consumer group. A subscription reads from the group's
// committed offset and waits for new records, like a real consumer does after
// joining. `disconnect()` makes the open subscription fail the way a dropped
// broker connection does.

import type {
  KafkaInboundRecord,
  KafkaProducerClient,
  KafkaOutboundRecord,
  KafkaSubscribe,
  KafkaSubscription,
} from '../kafka/kafka-client.js';

interface StoredRecord {
  readonly key: string | undefined;
  readonly value: string;
  readonly headers: Readonly<Record<string, string>>;
}

export class FakeKafkaTopic {
  readonly name: string;
  readonly records: StoredRecord[] = [];
  /** The group's committed offset: the next record it will read after joining. */
  committed = 0;
  subscribeCount = 0;
  /** Subscribe attempts left to fail (a broker that is down). */
  failSubscribes = 0;
  /** Commits left to fail. */
  failCommits = 0;
  private active: FakeSubscription | null = null;
  private listeners: (() => void)[] = [];

  constructor(name = 'adt') {
    this.name = name;
  }

  produce(value: string, key?: string, headers: Record<string, string> = {}): void {
    this.records.push({ key, value, headers });
    this.notify();
  }

  readonly subscribe: KafkaSubscribe = async () => {
    this.subscribeCount += 1;
    if (this.failSubscribes > 0) {
      this.failSubscribes -= 1;
      throw new Error('ECONNREFUSED broker down');
    }
    this.active = new FakeSubscription(this);
    return this.active;
  };

  /** Fail the open subscription as a dropped connection would. */
  disconnect(): void {
    this.active?.fail(new Error('ECONNRESET connection to broker lost'));
  }

  get isSubscribed(): boolean {
    return this.active !== null && !this.active.closed;
  }

  record(offset: number): KafkaInboundRecord {
    const stored = this.records[offset];
    if (!stored) throw new Error(`no record at ${String(offset)}`);
    return {
      topic: this.name,
      partition: 0,
      offset: BigInt(offset),
      timestamp: 1_700_000_000_000n,
      key: stored.key === undefined ? undefined : Buffer.from(stored.key),
      value: Buffer.from(stored.value),
      headers: new Map(Object.entries(stored.headers).map(([k, v]) => [Buffer.from(k), Buffer.from(v)])),
      commit: async (): Promise<void> => {
        if (this.failCommits > 0) {
          this.failCommits -= 1;
          throw new Error('commit failed: coordinator unavailable');
        }
        this.committed = Math.max(this.committed, offset + 1);
      },
    };
  }

  waitForChange(): Promise<void> {
    return new Promise((resolve) => { this.listeners.push(resolve); });
  }

  notify(): void {
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) listener();
  }
}

class FakeSubscription implements KafkaSubscription {
  closed = false;
  closedForcefully: boolean | null = null;
  private error: Error | null = null;
  private position: number;

  constructor(private readonly topic: FakeKafkaTopic) {
    this.position = topic.committed;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<KafkaInboundRecord> {
    while (!this.closed) {
      if (this.error) throw this.error;
      if (this.position < this.topic.records.length) {
        const offset = this.position;
        this.position += 1;
        yield this.topic.record(offset);
      } else {
        await this.topic.waitForChange();
      }
    }
  }

  async close(force: boolean): Promise<void> {
    this.closed = true;
    this.closedForcefully = force;
    this.topic.notify();
  }

  fail(error: Error): void {
    this.error = error;
    this.topic.notify();
  }
}

/** A producer that records what it was asked to send, or fails while `failSends` > 0. */
export class FakeKafkaProducer implements KafkaProducerClient {
  readonly sent: KafkaOutboundRecord[] = [];
  failSends = 0;
  closed = false;

  async send(record: KafkaOutboundRecord): Promise<{ topic: string; partition: number; offset: string }> {
    if (this.failSends > 0) {
      this.failSends -= 1;
      throw new Error('NOT_ENOUGH_REPLICAS');
    }
    this.sent.push(record);
    return { topic: record.topic, partition: 0, offset: String(this.sent.length - 1) };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
