import { describe, it, expect } from 'vitest';
import { readTlsServerOptions, readTlsClientOptions } from '../tls.js';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

const CERT = '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----';

describe('readTlsServerOptions()', () => {
  it('is undefined (plaintext) when no tls object is configured', () => {
    expect(readTlsServerOptions({})).toBeUndefined();
    expect(readTlsServerOptions({ tls: undefined })).toBeUndefined();
    expect(readTlsServerOptions({ tls: null })).toBeUndefined();
    expect(readTlsServerOptions({ tls: false })).toBeUndefined();
  });

  it('throws for a tls object present without cert and key, instead of listening in plaintext', () => {
    expect(() => readTlsServerOptions({ tls: {} })).toThrow(/incomplete/);
    expect(() => readTlsServerOptions({ tls: { requireClientCert: true } })).toThrow(/incomplete/);
    expect(() => readTlsServerOptions({ tls: { cert: '', key: '' } })).toThrow(/incomplete/);
  });

  it('returns the options when both cert and key are set', () => {
    expect(readTlsServerOptions({ tls: { cert: CERT, key: KEY, ca: CERT, requireClientCert: true } }))
      .toEqual({ cert: CERT, key: KEY, ca: CERT, requireClientCert: true });
  });

  it('throws when a certificate is set without its key', () => {
    expect(() => readTlsServerOptions({ tls: { cert: CERT } })).toThrow(/tls\.key/);
    expect(() => readTlsServerOptions({ tls: { cert: CERT, key: '' } })).toThrow(/tls\.key/);
  });

  it('throws when a key is set without its certificate', () => {
    expect(() => readTlsServerOptions({ tls: { key: KEY } })).toThrow(/tls\.cert/);
  });

  it('throws when only a CA bundle is set, since a listener cannot terminate TLS without cert and key', () => {
    expect(() => readTlsServerOptions({ tls: { ca: CERT } })).toThrow(/incomplete/);
  });

  it('throws when tls is set to something other than an object', () => {
    expect(() => readTlsServerOptions({ tls: true })).toThrow(/object/);
    expect(() => readTlsServerOptions({ tls: CERT })).toThrow(/object/);
  });

  it('throws when cert or key is not a string', () => {
    expect(() => readTlsServerOptions({ tls: { cert: 42, key: KEY } })).toThrow(/tls\.cert/);
  });

  it('never puts PEM material in the error message', () => {
    expect(() => readTlsServerOptions({ tls: { cert: CERT } })).not.toThrow(/BEGIN/);
  });
});

describe('readTlsClientOptions()', () => {
  it('is undefined when no tls object is configured', () => {
    expect(readTlsClientOptions({})).toBeUndefined();
    expect(readTlsClientOptions({ tls: null })).toBeUndefined();
    expect(readTlsClientOptions({ tls: false })).toBeUndefined();
  });

  it('returns options without a client certificate (server-auth-only TLS)', () => {
    expect(readTlsClientOptions({ tls: { ca: CERT, rejectUnauthorized: true } }))
      .toEqual({ cert: undefined, key: undefined, ca: CERT, rejectUnauthorized: true });
  });

  it('returns a client certificate and key together', () => {
    expect(readTlsClientOptions({ tls: { cert: CERT, key: KEY } })).toMatchObject({ cert: CERT, key: KEY });
  });

  it('throws when a client certificate is set without its key, or a key without its certificate', () => {
    expect(() => readTlsClientOptions({ tls: { cert: CERT } })).toThrow(/tls\.key/);
    expect(() => readTlsClientOptions({ tls: { key: KEY } })).toThrow(/tls\.cert/);
  });

  it('throws when tls is set to something other than an object', () => {
    expect(() => readTlsClientOptions({ tls: true })).toThrow(/object/);
  });
});

describe('registry factories with half-configured TLS', () => {
  it('refuses to build a TCP/MLLP source whose tls has a cert but no key, instead of listening in plaintext', () => {
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, tls: { cert: CERT } })).toThrow(/tls\.key/);
  });

  it('refuses to build a TCP/MLLP source whose tls object is empty or has settings but no cert and key', () => {
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, tls: {} })).toThrow(/incomplete/);
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, tls: { requireClientCert: true } })).toThrow(/incomplete/);
  });

  it('refuses to build an HTTPS source whose tls has a key but no cert, or no tls at all', () => {
    expect(() => createSourceConnector('HTTP', { port: 8080, scheme: 'HTTPS', tls: { key: KEY } })).toThrow(/tls\.cert/);
    expect(() => createSourceConnector('HTTP', { port: 8080, scheme: 'HTTPS' })).toThrow(/HTTPS/);
  });

  it('builds an HTTPS source from resolved PEM material', () => {
    expect(() => createSourceConnector('HTTP', { port: 8080, scheme: 'HTTPS', tls: { cert: CERT, key: KEY, requireClientCert: false } })).not.toThrow();
  });

  it('still builds a plaintext TCP/MLLP source and an HTTP source on scheme HTTP with its id-based tls bag', () => {
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661 })).not.toThrow();
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, tls: null })).not.toThrow();
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, tls: false })).not.toThrow();
    expect(() => createSourceConnector('HTTP', { port: 8080, scheme: 'HTTP', tls: { serverCertId: '', caCertId: '', requireClientCert: false } })).not.toThrow();
    expect(() => createSourceConnector('HTTP', { port: 8080, tls: { serverCertId: 'abc', caCertId: '', requireClientCert: true } })).not.toThrow();
  });

  it('refuses to build a TCP/MLLP destination with a client certificate but no key', () => {
    expect(() => createDestinationConnector('TCP_MLLP', { host: 'h', port: 6661, tls: { cert: CERT } })).toThrow(/tls\.key/);
  });
});
