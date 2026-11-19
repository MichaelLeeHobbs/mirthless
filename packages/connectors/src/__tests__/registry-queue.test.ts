import { describe, it, expect } from 'vitest';
import { createSourceConnector, createDestinationConnector, readQueueTls } from '../registry.js';
import { KafkaReceiver } from '../kafka/kafka-receiver.js';
import { KafkaDispatcher } from '../kafka/kafka-dispatcher.js';
import { AmqpReceiver } from '../amqp/amqp-receiver.js';
import { AmqpDispatcher } from '../amqp/amqp-dispatcher.js';

describe('readQueueTls', () => {
  it('is off unless useTls is set, whatever the tls bag holds', () => {
    expect(readQueueTls({ tls: { ca: 'CA' } })).toBeUndefined();
  });

  it('reads the PEM bag when useTls is set, and is an empty (verifying) bag when there is none', () => {
    expect(readQueueTls({ useTls: true, tls: { ca: 'CA', rejectUnauthorized: true } })).toMatchObject({ ca: 'CA', rejectUnauthorized: true });
    expect(readQueueTls({ useTls: true })).toEqual({});
  });
});

describe('createSourceConnector / createDestinationConnector', () => {
  it('builds Kafka and AMQP connectors from saved properties', () => {
    expect(createSourceConnector('KAFKA', { brokers: 'k:9092', topic: 't', groupId: 'g' })).toBeInstanceOf(KafkaReceiver);
    expect(createDestinationConnector('KAFKA', { brokers: 'k:9092', topic: 't' })).toBeInstanceOf(KafkaDispatcher);
    expect(createSourceConnector('AMQP', { host: 'rabbit', queue: 'q' })).toBeInstanceOf(AmqpReceiver);
    expect(createDestinationConnector('AMQP', { host: 'rabbit', routingKey: 'q' })).toBeInstanceOf(AmqpDispatcher);
  });

  it('ignores the stored certificate ids in tls; only PEM material from the server is used', () => {
    expect(() => createSourceConnector('AMQP', { host: 'rabbit', queue: 'q', useTls: true, tls: { caCertId: 'abc' } })).not.toThrow();
  });

  it('refuses a key the schema does not list, naming it', () => {
    expect(() => createSourceConnector('KAFKA', { brokers: 'k:9092', topic: 't', groupId: 'g', group: 'x' })).toThrow(/KAFKA properties are invalid: .*group/);
    expect(() => createDestinationConnector('AMQP', { host: 'rabbit', routingKey: 'q', persistent: true })).toThrow(/persistent/);
  });

  it('throws on properties the schema rejects, so the channel fails to deploy', () => {
    expect(() => createSourceConnector('KAFKA', { brokers: 'no-port', topic: 't', groupId: 'g' })).toThrow(/host:port/);
    expect(() => createSourceConnector('AMQP', { host: 'rabbit' })).toThrow();
    expect(() => createDestinationConnector('KAFKA', { brokers: 'k:9092', topic: 't', saslMechanism: 'PLAIN' })).toThrow(/SASL/);
  });
});
