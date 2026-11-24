import { describe, it, expect } from 'vitest';
import { createSourceConnector, createDestinationConnector } from '../registry.js';
import { freePort } from '../__fixtures__/free-port.js';

const SOURCE_PORT = await freePort();
const PEM = { cert: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----', key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----' };

describe('registry HTTP factories', () => {
  it('build from the properties the editor saves, a text port included', () => {
    expect(() => createSourceConnector('HTTP', {
      host: '0.0.0.0', port: '8080', path: '/', method: 'POST', responseStatusCode: 200, responseContentType: 'text/plain',
      errorStatusCode: 500, maxBodyBytes: 52428800, bodyCharset: 'utf-8', scheme: 'HTTP', tls: { serverCertId: '', caCertId: '', requireClientCert: false },
    })).not.toThrow();
    expect(() => createDestinationConnector('HTTP', {
      url: 'http://localhost:8080', method: 'POST', headers: {}, contentType: 'text/plain', responseTimeout: 30000,
      scheme: 'HTTP', tls: { caCertId: '', clientCertId: '', rejectUnauthorized: true },
    })).not.toThrow();
  });

  it('refuse a misspelled key instead of ignoring it', () => {
    expect(() => createSourceConnector('HTTP', { port: 8080, maxBodyByte: 10 })).toThrow(/HTTP properties are invalid: .*maxBodyByte/);
    expect(() => createDestinationConnector('HTTP', { url: 'http://lis', timeout: 5 })).toThrow(/timeout/);
  });

  it('build a source that reads bodies in its bodyCharset', async () => {
    const seen: string[] = [];
    const source = createSourceConnector('HTTP', { host: '127.0.0.1', port: SOURCE_PORT, bodyCharset: 'latin1' });
    source.setDispatcher(async (raw) => { seen.push(raw.content); return { ok: true, value: { messageId: 1 }, error: null }; });
    expect((await source.onStart()).ok).toBe(true);
    try {
      const res = await fetch(`http://127.0.0.1:${String(SOURCE_PORT)}/`, {
        method: 'POST', body: Buffer.from('PID|1||Müller', 'latin1'), headers: { connection: 'close' }, signal: AbortSignal.timeout(5_000),
      });
      expect(res.status).toBe(200);
    } finally {
      await source.onStop();
    }
    expect(seen).toEqual(['PID|1||Müller']);
  });

  it('refuse a bodyCharset the connector does not have', () => {
    expect(() => createSourceConnector('HTTP', { port: 8080, bodyCharset: 'shift_jis' })).toThrow(/HTTP properties are invalid: bodyCharset: /);
  });

  it('refuse a status code Node cannot write', () => {
    expect(() => createSourceConnector('HTTP', { port: 8080, errorStatusCode: 1000 })).toThrow(/errorStatusCode/);
  });

  it('refuse a response timeout of 0, which would abort every send', () => {
    expect(() => createDestinationConnector('HTTP', { url: 'http://lis', responseTimeout: 0 })).toThrow(/responseTimeout/);
  });

  it('build channels the 2026-02 to 2026-07 editor saved, old keys and header text included', () => {
    expect(() => createSourceConnector('HTTP', {
      host: '0.0.0.0', port: 8080, contextPath: '/', methods: ['POST'], responseStatusCode: 200, responseContentType: 'text/plain', charset: 'UTF-8',
    })).not.toThrow();
    expect(() => createDestinationConnector('HTTP', {
      url: 'http://lis', method: 'POST', headers: 'X-Site: east', contentType: 'text/plain', charset: 'UTF-8', responseTimeout: 30000,
      tls: { ca: '', cert: '', key: '', rejectUnauthorized: true },
    })).not.toThrow();
  });

  it('read the PEM the server resolved, which the stored-id schema would refuse', () => {
    expect(() => createSourceConnector('HTTP', { port: 8080, scheme: 'HTTPS', tls: { ...PEM, requireClientCert: false } })).not.toThrow();
    expect(() => createDestinationConnector('HTTP', { url: 'https://lis', scheme: 'HTTPS', tls: { ...PEM, rejectUnauthorized: true } })).not.toThrow();
  });

  it('still refuse HTTPS with no certificate, with the TLS message', () => {
    expect(() => createSourceConnector('HTTP', { port: 8080, scheme: 'HTTPS' })).toThrow(/scheme is HTTPS but no tls cert and key/);
  });
});
