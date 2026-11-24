import { describe, it, expect } from 'vitest';
import {
  httpSourcePropertiesSchema,
  httpDestinationPropertiesSchema,
  parseHeaderLines,
  DEFAULT_MAX_BODY_BYTES,
} from '../http-connector.schema.js';
import { QUEUE_CHARSETS } from '../queue-connector.schema.js';

const SOURCE_DEFAULTS = {
  host: '0.0.0.0',
  path: '/',
  method: 'POST',
  responseContentType: 'text/plain',
  responseStatusCode: 200,
  errorStatusCode: 500,
  maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
  bodyCharset: 'utf-8',
};

describe('httpSourcePropertiesSchema', () => {
  it('needs only a port and fills the defaults', () => {
    expect(httpSourcePropertiesSchema.parse({ port: 8080 })).toEqual({ ...SOURCE_DEFAULTS, port: 8080 });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      host: '127.0.0.1', port: '8080', path: '/api', matchSubpaths: true, method: 'PUT',
      responseContentType: 'application/json', responseStatusCode: 202, errorStatusCode: 503, maxBodyBytes: 1024, bodyCharset: 'base64',
      auth: { type: 'BASIC', username: 'u', password: 'p' }, scheme: 'HTTPS',
      tls: { serverCertId: 'srv', caCertId: 'ca', requireClientCert: true }, processBatch: true,
    };
    expect(httpSourcePropertiesSchema.parse(all)).toEqual({ ...all, port: 8080 });
  });

  it('accepts a bearer token guard', () => {
    const auth = { type: 'TOKEN', token: 't' };
    expect(httpSourcePropertiesSchema.parse({ port: 8080, auth }).auth).toEqual(auth);
  });

  it.each(QUEUE_CHARSETS)('accepts bodyCharset %s', (bodyCharset) => {
    expect(httpSourcePropertiesSchema.parse({ port: 8080, bodyCharset }).bodyCharset).toBe(bodyCharset);
  });

  it('rejects a missing port', () => {
    expect(httpSourcePropertiesSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    ['path', 'api'],
    ['matchSubpaths', 'yes'],
    ['method', 'HEAD'],
    ['responseStatusCode', 99],
    ['responseStatusCode', 600],
    ['errorStatusCode', '5xx'],
    ['maxBodyBytes', 0],
    ['bodyCharset', 'shift_jis'],
    ['bodyCharset', ''],
    ['auth', { type: 'DIGEST' }],
    ['auth', { type: 'TOKEN', secret: 't' }],
    // Missing credentials would let a request with empty ones in (#207).
    ['auth', { type: 'BASIC' }],
    ['auth', { type: 'BASIC', username: 'svc' }],
    ['auth', { type: 'BASIC', username: 'svc', password: '' }],
    ['auth', { type: 'BASIC', password: 'p' }],
    ['auth', { type: 'TOKEN' }],
    ['auth', { type: 'TOKEN', token: '' }],
    ['auth', { type: 'TOKEN', token: 't', username: 'svc' }],
    ['scheme', 'https'],
    ['tls', { serverCertId: 'srv', cert: 'PEM' }],
  ])('rejects %s = %j', (key, value) => {
    expect(httpSourcePropertiesSchema.safeParse({ port: 8080, [key]: value }).success).toBe(false);
  });

  it('rejects a key it does not know, naming it', () => {
    const result = httpSourcePropertiesSchema.safeParse({ port: 8080, responseStatus: 202 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('responseStatus');
  });

  it('reads a method in any case, as the connector does', () => {
    expect(httpSourcePropertiesSchema.parse({ port: 8080, method: ' put ' }).method).toBe('PUT');
  });

  it('accepts tls switched off as false or null', () => {
    expect(httpSourcePropertiesSchema.parse({ port: 8080, tls: false }).tls).toBeNull();
    expect(httpSourcePropertiesSchema.parse({ port: 8080, tls: null }).tls).toBeNull();
  });

  // What the HTTP source form saved from 58ab3ae to 349a666; edits keep these keys. No connector read them.
  it('deploys a channel the 2026-02 to 2026-07 editor saved, dropping its unread keys', () => {
    const saved = {
      host: '0.0.0.0', port: 8080, contextPath: '/', methods: ['POST'], responseStatusCode: 200,
      responseContentType: 'text/plain', charset: 'UTF-8',
    };
    expect(httpSourcePropertiesSchema.parse(saved)).toEqual({ ...SOURCE_DEFAULTS, port: 8080 });
  });

  // No connector read the old charset, so a channel saved with it must not start reading bodies another way.
  it('does not take the old charset as bodyCharset', () => {
    expect(httpSourcePropertiesSchema.parse({ port: 8080, charset: 'latin1' })).toEqual({ ...SOURCE_DEFAULTS, port: 8080 });
    expect(httpSourcePropertiesSchema.parse({ port: 8080, charset: 'base64', bodyCharset: 'latin1' }).bodyCharset).toBe('latin1');
  });
});

describe('httpDestinationPropertiesSchema', () => {
  it('needs a url and fills the defaults', () => {
    expect(httpDestinationPropertiesSchema.parse({ url: 'http://lis/orders' })).toEqual({
      url: 'http://lis/orders',
      method: 'POST',
      headers: {},
      contentType: 'text/plain',
      responseTimeout: 30_000,
    });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      url: 'https://lis/${accession}', method: 'PATCH', headers: { 'X-Site': '${site}' }, parameters: { a: 'b' },
      basicAuth: { username: 'u', password: 'p' }, contentType: 'application/json', responseTimeout: 5000,
      scheme: 'HTTPS', tls: { caCertId: 'ca', clientCertId: 'client', rejectUnauthorized: false }, template: '${message.encodedData}',
    };
    expect(httpDestinationPropertiesSchema.parse(all)).toEqual(all);
  });

  it.each([
    [{}],
    [{ url: ' ' }],
    [{ url: 'http://lis', method: 'TRACE' }],
    [{ url: 'http://lis', headers: { 'X-Count': 1 } }],
    [{ url: 'http://lis', parameters: 'a=b' }],
    [{ url: 'http://lis', basicAuth: { username: 'u' } }],
    [{ url: 'http://lis', responseTimeout: 0 }],
    [{ url: 'http://lis', scheme: 'FTP' }],
    [{ url: 'http://lis', tls: { caCertId: 'ca', serverCertId: 'srv' } }],
    [{ url: 'http://lis', tls: { ca: '-----BEGIN CERTIFICATE-----' } }],
    [{ url: 'http://lis', timeout: 5 }],
  ])('rejects %j', (props) => {
    expect(httpDestinationPropertiesSchema.safeParse(props).success).toBe(false);
  });

  // ea01d81 to 349a666: the form saved headers as text and a charset nothing read.
  it('deploys a channel the 2026-03 to 2026-07 editor saved, its header text read as the editor shows it', () => {
    const saved = { url: 'http://lis', method: 'POST', headers: 'X-Site: east\nX-Empty:', contentType: 'text/plain', charset: 'UTF-8', responseTimeout: 30000 };
    expect(httpDestinationPropertiesSchema.parse(saved).headers).toEqual({ 'X-Site': 'east', 'X-Empty': '' });
    expect(httpDestinationPropertiesSchema.parse({ ...saved, headers: '' })).toEqual(httpDestinationPropertiesSchema.parse({ url: 'http://lis' }));
  });

  // 85a4575 to 6437e13: the form saved an inline-PEM tls bag, empty unless pasted into.
  it('drops the empty PEM fields the 2026-07-14 editor saved in tls', () => {
    const saved = { url: 'https://lis', tls: { ca: '', cert: '', key: '', rejectUnauthorized: true } };
    expect(httpDestinationPropertiesSchema.parse(saved).tls).toEqual({ caCertId: '', clientCertId: '', rejectUnauthorized: true });
  });
});

describe('parseHeaderLines', () => {
  it('reads Name: value lines and skips lines with no name', () => {
    expect(parseHeaderLines('A: 1\r\n: 2\nnocolon\n B : x:y ')).toEqual({ A: '1', B: 'x:y' });
  });
});
