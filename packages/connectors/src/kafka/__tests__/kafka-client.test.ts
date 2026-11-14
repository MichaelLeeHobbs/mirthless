// ===========================================
// Kafka Client Option Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { clientOptions, describeKafkaError, parseBrokers, type KafkaConnectionConfig } from '../kafka-client.js';

describe('describeKafkaError', () => {
  it('adds the nested reasons to the generic client message', () => {
    const inner = new Error('UNKNOWN_TOPIC_OR_PARTITION');
    const outer = Object.assign(new Error('Producing messages failed.'), { errors: [new Error('Request failed', { cause: inner })] });
    expect(describeKafkaError(outer).message).toBe('Producing messages failed. Request failed; UNKNOWN_TOPIC_OR_PARTITION');
  });

  it('returns an error with no nested reasons unchanged, and wraps a non-error', () => {
    const plain = new Error('ECONNREFUSED');
    expect(describeKafkaError(plain)).toBe(plain);
    expect(describeKafkaError('boom').message).toBe('boom');
  });
});

const base: KafkaConnectionConfig = {
  brokers: 'k1:9092, k2:9093 ,',
  clientId: 'galvaniflow',
  saslMechanism: 'NONE',
  saslUsername: '',
  saslPassword: '',
};

describe('parseBrokers', () => {
  it('splits, trims and drops empty entries', () => {
    expect(parseBrokers(base.brokers)).toEqual(['k1:9092', 'k2:9093']);
    expect(parseBrokers(' , ')).toEqual([]);
  });
});

describe('clientOptions', () => {
  it('connects in plaintext without SASL by default', () => {
    expect(clientOptions(base)).toEqual({ clientId: 'galvaniflow', bootstrapBrokers: ['k1:9092', 'k2:9093'], timeout: 30_000 });
  });

  it('passes SASL credentials for the chosen mechanism', () => {
    const options = clientOptions({ ...base, saslMechanism: 'SCRAM-SHA-512', saslUsername: 'svc', saslPassword: 'pw' });
    expect(options.sasl).toEqual({ mechanism: 'SCRAM-SHA-512', username: 'svc', password: 'pw' });
  });

  it('verifies the broker certificate unless switched off, and passes PEM material', () => {
    expect(clientOptions({ ...base, tls: {} }).tls).toEqual({ rejectUnauthorized: true });
    expect(clientOptions({ ...base, tls: { ca: 'CA', cert: 'C', key: 'K' } }).tls).toEqual({ rejectUnauthorized: true, ca: 'CA', cert: 'C', key: 'K' });
    expect(clientOptions({ ...base, tls: { rejectUnauthorized: false } }).tls).toEqual({ rejectUnauthorized: false });
  });
});
