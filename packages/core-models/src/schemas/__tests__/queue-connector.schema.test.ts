// ===========================================
// Kafka and AMQP Connector Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  kafkaSourcePropertiesSchema,
  kafkaDestinationPropertiesSchema,
  amqpSourcePropertiesSchema,
  amqpDestinationPropertiesSchema,
} from '../queue-connector.schema.js';
import { connectorTypeSchema } from '../channel.schema.js';
import { connectionTestSchema } from '../connection-test.schema.js';
import { createDestinationConnectorSchema } from '../connector.schema.js';

describe('kafkaSourcePropertiesSchema', () => {
  const base = { brokers: 'kafka-1:9092, kafka-2:9093', topic: 'adt', groupId: 'galvaniflow-adt' };

  it('accepts a minimal source and applies defaults', () => {
    const parsed = kafkaSourcePropertiesSchema.parse(base);
    expect(parsed.clientId).toBe('galvaniflow');
    expect(parsed.startFrom).toBe('EARLIEST');
    expect(parsed.saslMechanism).toBe('NONE');
    expect(parsed.useTls).toBe(false);
  });

  it('rejects a broker list entry without a port', () => {
    const result = kafkaSourcePropertiesSchema.safeParse({ ...base, brokers: 'kafka-1:9092,kafka-2' });
    expect(result.success).toBe(false);
  });

  it('requires a consumer group', () => {
    expect(kafkaSourcePropertiesSchema.safeParse({ ...base, groupId: ' ' }).success).toBe(false);
  });

  it('requires a SASL username when a mechanism is chosen', () => {
    const result = kafkaSourcePropertiesSchema.safeParse({ ...base, saslMechanism: 'SCRAM-SHA-512' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['saslUsername']);
  });

  it('rejects an unknown SASL mechanism', () => {
    expect(kafkaSourcePropertiesSchema.safeParse({ ...base, saslMechanism: 'GSSAPI', saslUsername: 'u' }).success).toBe(false);
  });

  it('defaults the TLS references to verify the broker', () => {
    const parsed = kafkaSourcePropertiesSchema.parse({ ...base, useTls: true, tls: {} });
    expect(parsed.tls).toEqual({ caCertId: '', clientCertId: '', rejectUnauthorized: true });
  });

  it('decodes payloads as UTF-8 unless a charset is chosen', () => {
    expect(kafkaSourcePropertiesSchema.parse(base).charset).toBe('utf-8');
    expect(kafkaSourcePropertiesSchema.parse({ ...base, charset: 'latin1' }).charset).toBe('latin1');
  });

  it('rejects a charset the source cannot decode', () => {
    expect(kafkaSourcePropertiesSchema.safeParse({ ...base, charset: 'ebcdic' }).success).toBe(false);
  });

  it('stops after 5 failed store attempts unless told otherwise, and needs at least 1', () => {
    expect(kafkaSourcePropertiesSchema.parse(base).maxStoreAttempts).toBe(5);
    expect(kafkaSourcePropertiesSchema.parse({ ...base, maxStoreAttempts: '12' }).maxStoreAttempts).toBe(12);
    expect(kafkaSourcePropertiesSchema.safeParse({ ...base, maxStoreAttempts: 0 }).success).toBe(false);
    expect(kafkaSourcePropertiesSchema.safeParse({ ...base, maxStoreAttempts: 2.5 }).success).toBe(false);
  });
});

describe('kafkaDestinationPropertiesSchema', () => {
  it('defaults to no key and no headers', () => {
    const parsed = kafkaDestinationPropertiesSchema.parse({ brokers: 'k:9092', topic: 'out-${site}' });
    expect(parsed.messageKey).toBe('');
    expect(parsed.headers).toEqual({});
    expect(parsed.topic).toBe('out-${site}');
  });

  it('requires a topic', () => {
    expect(kafkaDestinationPropertiesSchema.safeParse({ brokers: 'k:9092' }).success).toBe(false);
  });
});

describe('amqpSourcePropertiesSchema', () => {
  it('accepts a minimal source and applies defaults', () => {
    const parsed = amqpSourcePropertiesSchema.parse({ host: 'rabbit', queue: 'adt' });
    expect(parsed.port).toBe(5672);
    expect(parsed.vhost).toBe('/');
  });

  it('accepts a port given as text', () => {
    expect(amqpSourcePropertiesSchema.parse({ host: 'rabbit', queue: 'adt', port: '5671' }).port).toBe(5671);
  });

  it('rejects a port out of range', () => {
    expect(amqpSourcePropertiesSchema.safeParse({ host: 'rabbit', queue: 'adt', port: 70000 }).success).toBe(false);
  });

  it('requires a queue', () => {
    expect(amqpSourcePropertiesSchema.safeParse({ host: 'rabbit' }).success).toBe(false);
  });

  it('decodes payloads as UTF-8 unless a charset is chosen, and accepts base64 for binary', () => {
    expect(amqpSourcePropertiesSchema.parse({ host: 'rabbit', queue: 'adt' }).charset).toBe('utf-8');
    expect(amqpSourcePropertiesSchema.parse({ host: 'rabbit', queue: 'adt', charset: 'base64' }).charset).toBe('base64');
    expect(amqpSourcePropertiesSchema.safeParse({ host: 'rabbit', queue: 'adt', charset: 'utf-16' }).success).toBe(false);
  });

  it('stops after 5 failed store attempts unless told otherwise', () => {
    expect(amqpSourcePropertiesSchema.parse({ host: 'rabbit', queue: 'adt' }).maxStoreAttempts).toBe(5);
    expect(amqpSourcePropertiesSchema.safeParse({ host: 'rabbit', queue: 'adt', maxStoreAttempts: -1 }).success).toBe(false);
  });
});

describe('amqpDestinationPropertiesSchema', () => {
  it('defaults to the default exchange and text/plain', () => {
    const parsed = amqpDestinationPropertiesSchema.parse({ host: 'rabbit', routingKey: 'adt' });
    expect(parsed.exchange).toBe('');
    expect(parsed.contentType).toBe('text/plain');
  });
});

describe('connector type lists', () => {
  it('include KAFKA and AMQP everywhere a channel names a connector type', () => {
    for (const type of ['KAFKA', 'AMQP']) {
      expect(connectorTypeSchema.safeParse(type).success).toBe(true);
      expect(connectionTestSchema.safeParse({ connectorType: type, mode: 'SOURCE', properties: {} }).success).toBe(true);
      expect(createDestinationConnectorSchema.safeParse({ name: 'd', connectorType: type, properties: {} }).success).toBe(true);
    }
  });
});
