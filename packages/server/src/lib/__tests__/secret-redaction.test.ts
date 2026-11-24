import { describe, it, expect } from 'vitest';
import { kafkaDestinationPropertiesSchema, amqpDestinationPropertiesSchema } from '@galvanigraph/core-models';
import {
  redactChannelDetail,
  REDACTED,
  isSecretPropertyKey,
  redactSettingValue,
  redactConnectorProperties,
  stripRedactedProperties,
} from '../secret-redaction.js';

describe('secret-redaction — settings', () => {
  it('masks a present secret value', () => {
    expect(redactSettingValue('smtp.auth_pass', 'password', 'hunter2')).toBe(REDACTED);
  });

  it('masks a value typed secret in any case, or with a secret key typed string', () => {
    expect(redactSettingValue('custom.value', 'Secret', 'hunter2')).toBe(REDACTED);
    expect(redactSettingValue('some.api_token', 'string', 'hunter2')).toBe(REDACTED);
  });

  it('passes through empty/null secret values (nothing to hide)', () => {
    expect(redactSettingValue('smtp.auth_pass', 'password', '')).toBe('');
    expect(redactSettingValue('smtp.auth_pass', 'password', null)).toBe(null);
  });

  it('passes through non-secret values unchanged', () => {
    expect(redactSettingValue('smtp.host', 'string', 'mail.example.com')).toBe('mail.example.com');
  });
});

describe('secret-redaction — connector properties', () => {
  it('detects secret property keys', () => {
    expect(isSecretPropertyKey('password')).toBe(true);
    expect(isSecretPropertyKey('authPass')).toBe(true);
    expect(isSecretPropertyKey('smtpPassword')).toBe(true);
    expect(isSecretPropertyKey('privateKeyPem')).toBe(true);
    expect(isSecretPropertyKey('apiKey')).toBe(true);
    expect(isSecretPropertyKey('host')).toBe(false);
  });

  it('masks secret-looking values but keeps structure and non-secrets', () => {
    const out = redactConnectorProperties({
      host: 'db.example.com',
      port: 5432,
      password: 'hunter2',
      apiKey: 'abc123',
      username: 'svc',
    });
    expect(out['host']).toBe('db.example.com');
    expect(out['port']).toBe(5432);
    expect(out['password']).toBe(REDACTED);
    expect(out['apiKey']).toBe(REDACTED);
    expect(out['username']).toBe('svc');
  });

  it('leaves empty secret values as-is (unset)', () => {
    const out = redactConnectorProperties({ password: '' });
    expect(out['password']).toBe('');
  });

  it('masks secrets nested at any depth (auth, inline TLS key, headers)', () => {
    const out = redactConnectorProperties({
      auth: { type: 'BASIC', username: 'svc', password: 'hunter2', token: 't0k' },
      tls: { cert: 'CERT-PEM', key: 'KEY-PEM', ca: 'CA-PEM' },
      headers: { Authorization: 'Bearer abc', 'X-API-Key': 'k1', Accept: 'application/json', Cookie: 's=1' },
    });
    expect(out['auth']).toEqual({ type: 'BASIC', username: 'svc', password: REDACTED, token: REDACTED });
    expect(out['tls']).toEqual({ cert: 'CERT-PEM', key: REDACTED, ca: 'CA-PEM' });
    expect(out['headers']).toEqual({
      Authorization: REDACTED, 'X-API-Key': REDACTED, Accept: 'application/json', Cookie: REDACTED,
    });
  });

  it('masks secrets inside arrays of objects without mutating the input', () => {
    const input = { attachments: [{ filename: 'a.txt', apiToken: 'x' }, 'plain'] };
    const out = redactConnectorProperties(input);
    expect(out['attachments']).toEqual([{ filename: 'a.txt', apiToken: REDACTED }, 'plain']);
    expect(input.attachments[0]).toEqual({ filename: 'a.txt', apiToken: 'x' });
  });

  it('treats only an exact `key` as secret, not keys that merely contain it', () => {
    expect(isSecretPropertyKey('key')).toBe(true);
    expect(isSecretPropertyKey('keyColumn')).toBe(false);
    expect(isSecretPropertyKey('x-api-key')).toBe(true);
  });

  // A redacted property is dropped on import: masking the Kafka record key would
  // publish an imported channel unkeyed, losing per-patient ordering without an error.
  it('masks only the passwords of the Kafka and AMQP connectors', () => {
    const tls = { caCertId: 'ca-1', clientCertId: 'client-1', rejectUnauthorized: true };
    const kafka = kafkaDestinationPropertiesSchema.parse({
      brokers: 'k1:9093', topic: 'results-${site}', messageKey: '${patientId}', headers: { site: '${site}' },
      useTls: true, tls, saslMechanism: 'PLAIN', saslUsername: 'svc', saslPassword: 'hunter2',
    });
    const amqp = amqpDestinationPropertiesSchema.parse({
      host: 'rabbit', exchange: 'hl7', routingKey: 'adt.${event}', username: 'svc', password: 'hunter2', useTls: true, tls,
    });
    expect(kafka.messageKey).toBe('${patientId}');
    expect(redactConnectorProperties(kafka)).toEqual({ ...kafka, saslPassword: REDACTED });
    expect(redactConnectorProperties(amqp)).toEqual({ ...amqp, password: REDACTED });
  });
});

describe('secret-redaction — channel detail', () => {
  it('redacts source and destination properties and leaves the rest', () => {
    const out = redactChannelDetail({
      name: 'c',
      sourceConnectorProperties: { auth: { password: 'p' } },
      destinations: [{ name: 'd', properties: { tls: { key: 'K' } } }, { name: 'e' }],
    });
    expect(out['name']).toBe('c');
    expect(out['sourceConnectorProperties']).toEqual({ auth: { password: REDACTED } });
    expect(out['destinations']).toEqual([{ name: 'd', properties: { tls: { key: REDACTED } } }, { name: 'e' }]);
  });
});

describe('stripRedactedProperties', () => {
  it('drops redacted credential values but keeps everything else', () => {
    const out = stripRedactedProperties({
      host: 'db.local', port: 5432, password: '__REDACTED__', apiKey: '__REDACTED__', username: 'svc',
    });
    expect(out).toEqual({ host: 'db.local', port: 5432, username: 'svc' });
    expect('password' in out).toBe(false);
    expect('apiKey' in out).toBe(false);
  });

  it('drops redacted values nested in objects and arrays', () => {
    const out = stripRedactedProperties({
      auth: { username: 'svc', password: '__REDACTED__' },
      tls: { cert: 'C', key: '__REDACTED__' },
      attachments: [{ filename: 'a', apiToken: '__REDACTED__' }, 'x'],
    });
    expect(out).toEqual({ auth: { username: 'svc' }, tls: { cert: 'C' }, attachments: [{ filename: 'a' }, 'x'] });
  });

  it('returns an empty object for null/non-object input', () => {
    expect(stripRedactedProperties(null)).toEqual({});
    expect(stripRedactedProperties(undefined)).toEqual({});
  });
});

describe('stripRedactedProperties with stored properties', () => {
  it('puts back the stored secret at each path that holds the marker, at any depth', () => {
    const stored = { password: 'p', auth: { basic: { password: 'q' } }, headers: { Authorization: 'r', Accept: 'a' } };
    const file = {
      password: REDACTED, auth: { basic: { password: REDACTED } }, headers: { Authorization: REDACTED, Accept: 'changed' },
    };
    expect(stripRedactedProperties(file, stored)).toEqual({
      password: 'p', auth: { basic: { password: 'q' } }, headers: { Authorization: 'r', Accept: 'changed' },
    });
  });

  it('leaves alone what the file holds in clear, and adds nothing the file does not name', () => {
    expect(stripRedactedProperties({ password: 'new' }, { password: 'old', token: 'old' })).toEqual({ password: 'new' });
  });

  it.each([
    ['nothing there', { auth: { password: REDACTED } }, { password: 'p' }],
    ['an empty secret', { auth: { password: REDACTED } }, { auth: { password: '' } }],
    ['a null secret', { auth: { password: REDACTED } }, { auth: { password: null } }],
    ['the marker itself', { auth: { password: REDACTED } }, { auth: { password: REDACTED } }],
    ['a secret that is not text', { auth: { password: REDACTED } }, { auth: { password: { nested: 'p' } } }],
    ['text where the file has an object', { auth: { password: REDACTED } }, { auth: 'p' }],
    ['a list where the file has an object', { auth: { password: REDACTED } }, { auth: [{ password: 'p' }] }],
    ['an inherited value', { auth: { password: REDACTED } }, { auth: Object.create({ password: 'p' }) as unknown }],
  ])('drops the marker when the stored value is %s', (_what, file, stored) => {
    expect(stripRedactedProperties(file, stored)).toEqual({ auth: {} });
  });

  it('never puts a stored value back under a key that is not a secret', () => {
    expect(stripRedactedProperties({ host: REDACTED, port: 1 }, { host: 'db', port: 1 })).toEqual({ port: 1 });
  });

  it('never puts a stored secret back inside a list', () => {
    const file = { attachments: [{ apiToken: REDACTED, deeper: { password: REDACTED } }, REDACTED] };
    const stored = { attachments: [{ apiToken: 't', deeper: { password: 'p' } }, 'x'] };
    expect(stripRedactedProperties(file, stored)).toEqual({ attachments: [{ deeper: {} }] });
  });

  it('reads stored properties that are not an object as none', () => {
    expect(stripRedactedProperties({ password: REDACTED, port: 1 }, null)).toEqual({ port: 1 });
    expect(stripRedactedProperties({ password: REDACTED, port: 1 }, ['p'])).toEqual({ port: 1 });
  });

  it('follows deeply nested properties without recursion', () => {
    const DEPTH = 20_000;
    const nested = (password: string): Record<string, unknown> => {
      let value: Record<string, unknown> = { password };
      for (let i = 0; i < DEPTH; i++) value = { a: value };
      return value;
    };
    let found: unknown = stripRedactedProperties(nested(REDACTED), nested('p'));
    for (let i = 0; i < DEPTH; i++) found = (found as { a: unknown }).a;
    expect(found).toEqual({ password: 'p' });
  });
});
