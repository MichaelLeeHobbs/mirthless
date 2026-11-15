// ===========================================
// TLS Property Reader Tests
// ===========================================
// Pins what readTlsServerOptions and readTlsClientOptions return for each shape
// a stored `tls` bag can take. A bag that is present but not a plain object (a
// string, an array, a number) is refused loudly instead of read as "no TLS".

import { describe, it, expect } from 'vitest';
import { readTlsServerOptions, readTlsClientOptions } from '../tls.js';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

const EXTRA = { cert: 'C', key: 'K', ca: 'A', caCertId: 'ca-1', note: 'x' };
const NOT_AN_OBJECT = 'Connector tls settings must be an object';
const JUNK: ReadonlyArray<readonly [string, unknown]> = [
  ['a string', 'abc'],
  ['an array', []],
  ['a number', 1],
  ['true', true],
];

describe('readTlsServerOptions', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['false', false],
    ['an empty object', {}],
    ['a cert without a key', { cert: 'C' }],
    ['only rejectUnauthorized', { rejectUnauthorized: false }],
  ])('returns undefined when tls is %s', (_label, tls) => {
    expect(readTlsServerOptions({ tls })).toBeUndefined();
  });

  it.each(JUNK)('throws when tls is %s', (_label, tls) => {
    expect(() => readTlsServerOptions({ tls })).toThrow(NOT_AN_OBJECT);
  });

  it('returns cert and key when both are set', () => {
    expect(readTlsServerOptions({ tls: { cert: 'C', key: 'K' } })).toEqual({ cert: 'C', key: 'K', ca: undefined, requireClientCert: undefined });
  });

  it('keeps only the four server fields from a bag with extra keys', () => {
    expect(readTlsServerOptions({ tls: { ...EXTRA, requireClientCert: true } })).toEqual({ cert: 'C', key: 'K', ca: 'A', requireClientCert: true });
  });
});

describe('readTlsClientOptions', () => {
  it.each([
    ['missing', {}],
    ['undefined', { tls: undefined }],
    ['null', { tls: null }],
    ['false', { tls: false }],
  ])('returns undefined when tls is %s', (_label, props) => {
    expect(readTlsClientOptions(props)).toBeUndefined();
  });

  it.each(JUNK)('throws when tls is %s', (_label, tls) => {
    expect(() => readTlsClientOptions({ tls })).toThrow(NOT_AN_OBJECT);
  });

  it('returns an object of undefined fields for an empty object, so TLS stays on with defaults', () => {
    expect(readTlsClientOptions({ tls: {} })).toEqual({ cert: undefined, key: undefined, ca: undefined, rejectUnauthorized: undefined });
  });

  it('returns an object of undefined fields for a bag of certificate ids only', () => {
    expect(readTlsClientOptions({ tls: { caCertId: 'x' } })).toEqual({ cert: undefined, key: undefined, ca: undefined, rejectUnauthorized: undefined });
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

describe('creating a connector with a malformed tls bag', () => {
  it.each([['abc'], [[]]])('refuses a TCP/MLLP destination with tls %j', (tls) => {
    expect(() => createDestinationConnector('TCP_MLLP', { host: 'h', port: 6661, tls })).toThrow(NOT_AN_OBJECT);
  });

  it.each([['abc'], [[]]])('refuses an HTTP destination with tls %j', (tls) => {
    expect(() => createDestinationConnector('HTTP', { url: 'https://x', tls })).toThrow(NOT_AN_OBJECT);
  });

  it.each([['abc'], [[]]])('refuses a TCP/MLLP source with tls %j', (tls) => {
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, tls })).toThrow(NOT_AN_OBJECT);
  });

  it.each([[{}], [{ caCertId: 'x' }]])('still builds a TCP/MLLP destination with tls %j', (tls) => {
    expect(() => createDestinationConnector('TCP_MLLP', { host: 'h', port: 6661, tls })).not.toThrow();
  });

  it('builds a queue connector with junk in tls while useTls is off', () => {
    expect(() => createDestinationConnector('AMQP', { host: 'rabbit', queue: 'q', useTls: false, tls: 'abc' })).not.toThrow();
  });
});
