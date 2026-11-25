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

describe('secret-redaction: credentials under a key that names none', () => {
  it('masks the secret lines of headers saved as text and keeps the rest', () => {
    const out = redactConnectorProperties({
      headers: 'Accept: application/json\r\n Authorization :  Bearer a:b\r\n\r\nX-Api-Key:k\nCookie:\nnot a header\nkey: k',
    });
    expect(out['headers']).toBe(
      `Accept: application/json\r\n Authorization :  ${REDACTED}\r\n\r\nX-Api-Key:${REDACTED}\nCookie:\nnot a header\nkey: ${REDACTED}`,
    );
  });

  it.each([
    ['a user and password', 'https://svc:hunter2@host.example:8443/in?a=1#f', `https://${REDACTED}@host.example:8443/in?a=1#f`],
    ['a token as the user', 'https://hunter2@host.example/', `https://${REDACTED}@host.example/`],
    ['a password that holds an @', 'https://svc:hun@ter2@host.example/', `https://${REDACTED}@host.example/`],
    ['no path', 'amqp://svc:hunter2@mq', `amqp://${REDACTED}@mq`],
    ['a backslash in the password of a scheme that allows one', 'amqp://svc:hun\\ter2@mq/v', `amqp://${REDACTED}@mq/v`],
    ['spaces and capitals before it', '  HTTPS://svc:hunter2@host.example/', `  HTTPS://${REDACTED}@host.example/`],
    ['no slashes, as the URL parser allows for http', 'https:svc:hunter2@host.example/', `https:${REDACTED}@host.example/`],
    ['backslashes for slashes', 'https:\\\\svc:hunter2@host.example\\in', `https:\\\\${REDACTED}@host.example\\in`],
    ['a message variable in the host', 'https://svc:hunter2@${site}.example/', `https://${REDACTED}@\${site}.example/`],
    ['a secret query parameter', 'https://host.example/in?site=lab&apiKey=hunter2&token=&key=a=b#f', `https://host.example/in?site=lab&apiKey=${REDACTED}&token=&key=${REDACTED}#f`],
    ['a percent-encoded parameter name', 'https://host.example/?api%4Bey=hunter2', `https://host.example/?api%4Bey=${REDACTED}`],
    ['both', 'https://svc:hunter2@host.example?access_token=x', `https://${REDACTED}@host.example?access_token=${REDACTED}`],
  ])('masks the credentials in a URL with %s', (_what, url, masked) => {
    expect(redactConnectorProperties({ url, nested: { baseUrl: url }, list: [url] })).toEqual({ url: masked, nested: { baseUrl: masked }, list: [masked] });
  });

  it.each([
    'https://host.example/users/bob@example.org?mail=bob@example.org',
    'https://host.example/%zz?%zz=1',
    'bob@example.org',
    'Alert: contact bob@example.org',
    'SELECT * FROM t WHERE token = :token',
    "return httpFetch('https://svc:hunter2@host.example/');",
    '',
  ])('leaves %s as it is', (text) => {
    expect(redactConnectorProperties({ url: text })).toEqual({ url: text });
  });

  it('masks a URL in a header, as text or in a map', () => {
    const masked = `https://${REDACTED}@h/`;
    expect(redactConnectorProperties({ headers: 'Referer: https://u:p@h/' })).toEqual({ headers: `Referer: ${masked}` });
    expect(redactConnectorProperties({ headers: { Referer: 'https://u:p@h/' } })).toEqual({ headers: { Referer: masked } });
  });

  it.each(['keyStorePW', 'trustStorePW', 'keyStorePw', 'pw', 'db_pw', 'X-Pwd', 'userPwd'])('masks %s', (key) => {
    expect(redactConnectorProperties({ [key]: 'hunter2' })).toEqual({ [key]: REDACTED });
  });

  it.each(['pwFile', 'spw', 'upward'])('does not mask %s', (key) => {
    expect(redactConnectorProperties({ [key]: 'x' })).toEqual({ [key]: 'x' });
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

  const URL = 'https://svc:hunter2@host.example/in?token=t&a=1';
  const HEADERS = 'Accept: text/plain\r\nAuthorization: Bearer b\nX-Api-Key: k';
  const masked = (key: string, text: string): string => redactConnectorProperties({ [key]: text })[key] as string;

  it.each([['url', URL], ['headers', HEADERS]])('puts back the stored %s when the file changes nothing but the masks', (key, stored) => {
    expect(masked(key, stored)).not.toBe(stored);
    expect(stripRedactedProperties({ [key]: masked(key, stored) }, { [key]: stored })).toEqual({ [key]: stored });
  });

  it.each([
    ['another host', masked('url', URL).replace('host.example', 'attacker.example'), URL],
    ['another parameter', masked('url', URL).replace('a=1', 'a=2'), URL],
    ['nothing stored', masked('url', URL), undefined],
    ['the marker stored', masked('url', URL), masked('url', URL)],
    ['something that is not text stored', masked('url', URL), { url: URL }],
  ])('drops a masked URL with %s, so that the deploy fails instead of sending the mask', (_what, file, stored) => {
    expect(stripRedactedProperties({ url: file, port: 1 }, { url: stored })).toEqual({ port: 1 });
    expect(stripRedactedProperties({ urls: [file, 'x'] }, { urls: [stored, 'x'] })).toEqual({ urls: ['x'] });
  });

  it.each([
    ['another header', 'Accept: a/b\nAuthorization: Bearer b'],
    ['nothing stored', undefined],
    ['headers stored as a map', { Accept: 'text/plain', Authorization: 'Bearer b' }],
  ])('drops only the masked lines of headers saved as text with %s', (_what, stored) => {
    const file = `Accept: text/plain\nAuthorization: ${REDACTED}\r\n Cookie :${REDACTED}\nX-Site: lab`;
    expect(stripRedactedProperties({ headers: file }, { headers: stored })).toEqual({ headers: 'Accept: text/plain\nX-Site: lab' });
  });

  it('keeps text that names the marker and is neither headers nor a URL', () => {
    const script = `return msg === '${REDACTED}';`;
    expect(stripRedactedProperties({ script }, { script: 'old' })).toEqual({ script });
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
