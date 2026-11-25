import { describe, it, expect, vi } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import { KafkaDispatcher, type KafkaDispatcherConfig } from '../kafka-dispatcher.js';
import { FakeKafkaProducer } from '../../__fixtures__/fake-kafka.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

const config: KafkaDispatcherConfig = {
  brokers: 'kafka:9092',
  clientId: 'galvanigraph',
  saslMechanism: 'NONE',
  saslUsername: '',
  saslPassword: '',
  topic: 'results',
  messageKey: '',
  headers: {},
};

const message = (variables?: Record<string, unknown>): ConnectorMessage => ({
  channelId: 'c1', messageId: 7, metaDataId: 1, content: 'MSH|^~\\&|LAB', dataType: 'HL7V2', variables,
});

async function started(overrides: Partial<KafkaDispatcherConfig> = {}): Promise<{ dispatcher: KafkaDispatcher; producer: FakeKafkaProducer }> {
  const producer = new FakeKafkaProducer();
  const dispatcher = new KafkaDispatcher({ ...config, ...overrides }, () => producer);
  expect((await dispatcher.onDeploy()).ok).toBe(true);
  expect((await dispatcher.onStart()).ok).toBe(true);
  return { dispatcher, producer };
}

describe('onDeploy', () => {
  it('requires a broker and a topic', async () => {
    expect((await new KafkaDispatcher({ ...config, brokers: '' }).onDeploy()).ok).toBe(false);
    expect((await new KafkaDispatcher({ ...config, topic: '' }).onDeploy()).ok).toBe(false);
  });
});

describe('send', () => {
  it('publishes the content and reports where the broker stored it', async () => {
    const { dispatcher, producer } = await started();
    const result = await dispatcher.send(message(), new AbortController().signal);
    expect(result.ok && result.value.status).toBe('SENT');
    expect(producer.sent[0]?.value.toString()).toBe('MSH|^~\\&|LAB');
    expect(producer.sent[0]?.key).toBeUndefined();
    expect(JSON.parse(result.value?.content ?? '')).toEqual({ topic: 'results', partition: 0, offset: '0' });
  });

  it('fills topic, key and header values from the message variables', async () => {
    const { dispatcher, producer } = await started({
      topic: 'results-${site}',
      messageKey: '${patientId}',
      headers: { source: 'galvanigraph', trace: '${traceId}' },
    });
    await dispatcher.send(message({ site: 'north', patientId: 'P42', traceId: 't-1' }), new AbortController().signal);
    const sent = producer.sent[0];
    expect(sent?.topic).toBe('results-north');
    expect(sent?.key?.toString()).toBe('P42');
    expect(sent?.headers['source']?.toString()).toBe('galvanigraph');
    expect(sent?.headers['trace']?.toString()).toBe('t-1');
  });

  it('errors instead of publishing when the topic names a variable the message lacks', async () => {
    const { dispatcher, producer } = await started({ topic: 'results-${site}' });
    const result = await dispatcher.send(message({}), new AbortController().signal);
    expect(result.ok && result.value.status).toBe('ERROR');
    expect(result.value?.errorMessage).toContain('results-${site}');
    expect(producer.sent).toHaveLength(0);
  });

  it('returns an error when the broker refuses the record, so the message can queue and retry', async () => {
    const { dispatcher, producer } = await started();
    producer.failSends = 1;
    const failed = await dispatcher.send(message(), new AbortController().signal);
    expect(failed.ok).toBe(false);
    expect(failed.error?.message).toContain('NOT_ENOUGH_REPLICAS');
    const retried = await dispatcher.send(message(), new AbortController().signal);
    expect(retried.ok && retried.value.status).toBe('SENT');
  });

  it('refuses to send before start and after an aborted signal', async () => {
    const notStarted = new KafkaDispatcher(config, () => new FakeKafkaProducer());
    expect((await notStarted.send(message(), new AbortController().signal)).ok).toBe(false);
    const { dispatcher } = await started();
    const controller = new AbortController();
    controller.abort();
    expect((await dispatcher.send(message(), controller.signal)).ok).toBe(false);
  });

  it.each([
    ['halt', 'onHalt', 2_000],
    ['stop', 'onStop', 10_000],
  ] as const)('a %s ends although the broker never answers the close (#413)', async (_what, action, withinMs) => {
    const producer = new FakeKafkaProducer();
    producer.hangClose = true;
    const dispatcher = new KafkaDispatcher(config, () => producer, makeMockLogger().logger);
    await dispatcher.onStart();
    vi.useFakeTimers();
    try {
      const ending = dispatcher[action]();
      await vi.advanceTimersByTimeAsync(withinMs);
      expect((await ending).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the producer on stop', async () => {
    const { dispatcher, producer } = await started();
    expect((await dispatcher.onStop()).ok).toBe(true);
    expect(producer.closed).toBe(true);
    expect((await dispatcher.send(message(), new AbortController().signal)).ok).toBe(false);
  });
});
