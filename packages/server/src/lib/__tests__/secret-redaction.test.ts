// ===========================================
// Secret Redaction Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  redactChannelDetail,
  REDACTED,
  isSecretSettingType,
  isSecretSetting,
  isSecretPropertyKey,
  redactSettingValue,
  redactConnectorProperties,
} from '../secret-redaction.js';

describe('secret-redaction — settings', () => {
  it('detects secret types', () => {
    expect(isSecretSettingType('password')).toBe(true);
    expect(isSecretSettingType('secret')).toBe(true);
    expect(isSecretSettingType('string')).toBe(false);
    expect(isSecretSettingType(null)).toBe(false);
  });

  it('detects secret settings by key even when type is string (legacy)', () => {
    expect(isSecretSetting('smtp.auth_pass', 'string')).toBe(true);
    expect(isSecretSetting('some.api_token', 'string')).toBe(true);
    expect(isSecretSetting('smtp.host', 'string')).toBe(false);
  });

  it('masks a present secret value', () => {
    expect(redactSettingValue('smtp.auth_pass', 'password', 'hunter2')).toBe(REDACTED);
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
