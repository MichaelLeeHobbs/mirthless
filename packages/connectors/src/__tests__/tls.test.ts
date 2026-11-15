// ===========================================
// TLS Property Reader Tests
// ===========================================
// Pins what readTlsServerOptions and readTlsClientOptions return for each shape
// a stored `tls` bag can take, including malformed ones (a string, an array).

import { describe, it, expect } from 'vitest';
import { readTlsServerOptions, readTlsClientOptions } from '../tls.js';

const EXTRA = { cert: 'C', key: 'K', ca: 'A', caCertId: 'ca-1', note: 'x' };

describe('readTlsServerOptions', () => {
  it.each([
    ['absent', undefined],
    ['a string', 'abc'],
    ['an array', []],
    ['an empty object', {}],
    ['a cert without a key', { cert: 'C' }],
    ['only rejectUnauthorized', { rejectUnauthorized: false }],
  ])('returns undefined when tls is %s', (_label, tls) => {
    expect(readTlsServerOptions({ tls })).toBeUndefined();
  });

  it('returns cert and key when both are set', () => {
    expect(readTlsServerOptions({ tls: { cert: 'C', key: 'K' } })).toEqual({ cert: 'C', key: 'K', ca: undefined, requireClientCert: undefined });
  });

  it('keeps only the four server fields from a bag with extra keys', () => {
    expect(readTlsServerOptions({ tls: { ...EXTRA, requireClientCert: true } })).toEqual({ cert: 'C', key: 'K', ca: 'A', requireClientCert: true });
  });
});

describe('readTlsClientOptions', () => {
  it('returns undefined when tls is absent', () => {
    expect(readTlsClientOptions({})).toBeUndefined();
    expect(readTlsClientOptions({ tls: undefined })).toBeUndefined();
  });

  it.each([
    ['a string', 'abc'],
    ['an array', []],
    ['an empty object', {}],
  ])('returns an object of undefined fields when tls is %s', (_label, tls) => {
    expect(readTlsClientOptions({ tls })).toEqual({ cert: undefined, key: undefined, ca: undefined, rejectUnauthorized: undefined });
  });

  it('returns a lone cert', () => {
    expect(readTlsClientOptions({ tls: { cert: 'C' } })).toEqual({ cert: 'C', key: undefined, ca: undefined, rejectUnauthorized: undefined });
  });

  it('returns cert and key for mutual TLS', () => {
    expect(readTlsClientOptions({ tls: { cert: 'C', key: 'K' } })).toEqual({ cert: 'C', key: 'K', ca: undefined, rejectUnauthorized: undefined });
  });

  it('returns rejectUnauthorized: false when verification is switched off', () => {
    expect(readTlsClientOptions({ tls: { rejectUnauthorized: false } })).toEqual({ cert: undefined, key: undefined, ca: undefined, rejectUnauthorized: false });
  });

  it('keeps only the four client fields from a bag with extra keys', () => {
    expect(readTlsClientOptions({ tls: { ...EXTRA, rejectUnauthorized: true } })).toEqual({ cert: 'C', key: 'K', ca: 'A', rejectUnauthorized: true });
  });
});
