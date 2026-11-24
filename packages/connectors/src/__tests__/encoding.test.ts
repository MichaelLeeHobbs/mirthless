import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeEncoding, isKnownEncoding } from '../encoding.js';

/** TextDecoder's options; the DOM lib that names them is not loaded here. */
type DecoderOptions = ConstructorParameters<typeof TextDecoder>[1];

describe('normalizeEncoding', () => {
  it('maps IANA/human charset names to valid Node Buffer encodings', () => {
    expect(normalizeEncoding('ISO-8859-1')).toBe('latin1');
    expect(normalizeEncoding('US-ASCII')).toBe('ascii');
    expect(normalizeEncoding('UTF-8')).toBe('utf8');
    expect(normalizeEncoding('utf-16le')).toBe('utf16le');
  });

  it('is case-insensitive', () => {
    expect(normalizeEncoding('iso-8859-1')).toBe('latin1');
    expect(normalizeEncoding('Ascii')).toBe('ascii');
  });

  it('falls back to utf8 for empty/unknown values', () => {
    expect(normalizeEncoding('')).toBe('utf8');
    expect(normalizeEncoding(undefined)).toBe('utf8');
    expect(normalizeEncoding(null)).toBe('utf8');
    expect(normalizeEncoding('made-up-charset')).toBe('utf8');
  });

  it('returns only encodings Node actually accepts', () => {
    for (const input of ['ISO-8859-1', 'US-ASCII', 'UTF-8', 'utf-16le', 'weird']) {
      expect(Buffer.isEncoding(normalizeEncoding(input))).toBe(true);
    }
  });
});

describe('isKnownEncoding', () => {
  it('knows the supported names in any case, and an empty value (the UTF-8 default)', () => {
    for (const name of ['utf-8', 'UTF8', 'ISO-8859-1', 'latin1', 'us-ascii', 'utf-16le', '', undefined, null]) {
      expect(isKnownEncoding(name)).toBe(true);
    }
  });

  it('does not know character sets Node cannot decode', () => {
    for (const name of ['windows-1252', 'shift_jis', 'utf-9']) {
      expect(isKnownEncoding(name)).toBe(false);
    }
  });
});

describe('decodePayload on a Node without windows-1252 (no full ICU)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('still loads and decodes the other charsets; only windows-1252 fails, when used', async () => {
    const Real = globalThis.TextDecoder;
    vi.stubGlobal('TextDecoder', class extends Real {
      constructor(label?: string, options?: DecoderOptions) {
        if (label === 'windows-1252') throw new RangeError('The "windows-1252" encoding is not supported');
        super(label, options);
      }
    });
    vi.resetModules();
    const { decodePayload } = await import('../encoding.js');
    expect(decodePayload(Buffer.from('MSH|1'), 'utf-8')).toEqual({ text: 'MSH|1', replaced: false });
    expect(decodePayload(Buffer.from([0xe9]), 'latin1').text).toBe('é');
    expect(() => decodePayload(Buffer.from([0x93]), 'windows-1252')).toThrow('windows-1252');
  });

  it('fails the deploy of a Kafka, AMQP or HTTP source set to windows-1252', async () => {
    const Real = globalThis.TextDecoder;
    vi.stubGlobal('TextDecoder', class extends Real {
      constructor(label?: string, options?: DecoderOptions) {
        if (label === 'windows-1252') throw new RangeError('The "windows-1252" encoding is not supported');
        super(label, options);
      }
    });
    vi.resetModules();
    const { createSourceConnector } = await import('../registry.js');
    const kafka = { brokers: 'k:9092', topic: 't', groupId: 'g' };
    const amqp = { host: 'rabbit', queue: 'q' };
    expect(() => createSourceConnector('KAFKA', { ...kafka, charset: 'windows-1252' })).toThrow(/windows-1252.*not available/);
    expect(() => createSourceConnector('AMQP', { ...amqp, charset: 'windows-1252' })).toThrow(/windows-1252.*not available/);
    expect(() => createSourceConnector('AMQP', { ...amqp, charset: 'latin1' })).not.toThrow();
    const http = await createSourceConnector('HTTP', { port: 8080, bodyCharset: 'windows-1252' }).onDeploy();
    expect(http.ok ? null : http.error.message).toMatch(/windows-1252.*not available/);
    expect((await createSourceConnector('HTTP', { port: 8080, bodyCharset: 'latin1' }).onDeploy()).ok).toBe(true);
  }, 30_000); // a fresh import of the registry loads every connector
});
