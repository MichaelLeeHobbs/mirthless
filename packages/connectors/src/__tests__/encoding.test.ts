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

describe('decodePayload in windows-1252, whatever the TextDecoder of this Node does with it (#391)', () => {
  const Real = globalThis.TextDecoder;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([
    ['this Node', Real],
    ['a Node that decodes it as Latin-1 (22.20, 24.13)', class extends Real {
      override decode(...args: Parameters<InstanceType<typeof Real>['decode']>): string {
        return this.encoding === 'windows-1252' ? Buffer.from(args[0] as Uint8Array).toString('latin1') : super.decode(...args);
      }
    }],
    ['a Node without full ICU, which does not have it', class extends Real {
      constructor(label?: string, options?: DecoderOptions) {
        if (label === 'windows-1252') throw new RangeError('The "windows-1252" encoding is not supported');
        super(label, options);
      }
    }],
  ])('reads the same text on %s', async (_node, Decoder) => {
    vi.stubGlobal('TextDecoder', Decoder);
    vi.resetModules();
    const { decodePayload } = await import('../encoding.js');

    expect(decodePayload(Buffer.from([0x93, 0x41, 0xfc, 0x94, 0x20, 0x80]), 'windows-1252')).toEqual({ text: '\u201cAü\u201d \u20ac', replaced: false });
    expect(decodePayload(Buffer.from([0x93]), 'latin1').text).toBe('\u0093');
    expect(decodePayload(Buffer.from('MSH|1'), 'utf-8')).toEqual({ text: 'MSH|1', replaced: false });
  });
});
