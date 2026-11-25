import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeEncoding, isKnownEncoding, decodeAnswer, encodeText } from '../encoding.js';

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

describe('decodeAnswer (#415)', () => {
  it.each([
    ['ISO-8859-1', 'text/plain; charset=ISO-8859-1', [0x4d, 0xfc, 0x6c], 'Mül'],
    ['a quoted charset in any case', 'text/xml; Charset="iso-8859-1"; x=y', [0xe9], 'é'],
    ['Windows-1252', 'text/plain;charset=windows-1252', [0x93, 0x41, 0x94], '“A”'],
    ['UTF-16', 'text/plain; charset=utf-16le', [0xff, 0xfe, 0x41, 0x00, 0x7c, 0x20], 'A⁼'],
    ['UTF-8 declared', 'application/json; charset=UTF-8', [...Buffer.from('Mül')], 'Mül'],
    ['UTF-8 when no charset is declared', 'application/json', [...Buffer.from('Mül')], 'Mül'],
    ['UTF-8 with no Content-Type', null, [...Buffer.from('Mül')], 'Mül'],
    ['UTF-8 without its byte order mark', null, [0xef, 0xbb, 0xbf, 0x7b, 0x7d], '{}'],
    ['UTF-16 with a byte order mark that says big-endian', 'text/xml; charset=UTF-16', [0xfe, 0xff, 0x00, 0x41, 0x00, 0xfc], 'A\u00fc'],
    ['UTF-8 with a byte order mark, whatever it declares, as browsers do', 'text/plain; charset=ISO-8859-1', [0xef, 0xbb, 0xbf, ...Buffer.from('M\u00fcl')], 'M\u00fcl'],
    ['the first of two Content-Types that fetch joined', 'text/plain; charset=ISO-8859-1, text/plain', [0xfc], '\u00fc'],
    ['an empty answer in a charset nobody knows', 'text/plain; charset=x-none', [], ''],
  ])('reads %s', (_name, contentType, bytes, text) => {
    expect(decodeAnswer(Buffer.from(bytes), { contentType })).toEqual({ text, problem: null });
  });

  it('says what it could not read, and keeps what it could', () => {
    expect(decodeAnswer(Buffer.from([0x4d, 0xfc, 0x6c]), { contentType: 'text/plain' })).toEqual({ text: 'M�l', problem: 'it is not valid utf-8' });
    expect(decodeAnswer(Buffer.from([0x41, 0x82]), { contentType: 'text/plain; charset=shift_jis' })).toEqual({ text: 'A�', problem: 'it is not valid shift_jis' });
    expect(decodeAnswer(Buffer.from('Mül'), { contentType: 'text/plain; charset=x-none' })).toEqual({ text: 'Mül', problem: 'its charset is not known, so it was read as utf-8' });
    expect(decodeAnswer(Buffer.from([0x4d, 0xfc]), { contentType: 'text/plain; charset=x-none' })).toEqual({ text: 'M�', problem: 'its charset is not known, so it was read as utf-8, which it is not' });
  });
});

describe('decodeAnswer of a compressed answer', () => {
  it('says that it was not decompressed, whatever charset it declares', () => {
    const contentType = 'text/plain; charset=ISO-8859-1';
    expect(decodeAnswer(Buffer.from([0x1f, 0x8b]), { contentType, contentEncoding: 'gzip' })).toEqual({ text: '\u001f\u2039', problem: 'it is compressed (gzip) and was not decompressed' });
    expect(decodeAnswer(Buffer.from('ok'), { contentType, contentEncoding: 'Identity' })).toEqual({ text: 'ok', problem: null });
  });
});

describe('decodeAnswer on a Node that decodes windows-1252 as Latin-1 (#391)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads a declared Windows-1252 right', () => {
    vi.stubGlobal('TextDecoder', class extends TextDecoder {
      override decode(...args: Parameters<InstanceType<typeof TextDecoder>['decode']>): string {
        return this.encoding === 'windows-1252' ? Buffer.from(args[0] as Uint8Array).toString('latin1') : super.decode(...args);
      }
    });
    expect(decodeAnswer(Buffer.from([0x93, 0x41]), { contentType: 'text/plain; charset=windows-1252' })).toEqual({ text: '\u201cA', problem: null });
  });
});

describe('encodeText (#415)', () => {
  it.each([
    ['utf-8', 'Mül “A” 😀'],
    ['latin1', 'Mül \u0080ÿ'],
    ['ascii', 'MSH|^~\\&|\r\n\u007f'],
    ['utf16le', 'Mül 😀 \ud83d'],
    ['utf-8', ''],
  ] as const)('writes text that %s can hold', (charset, text) => {
    expect(encodeText(text, charset)).toEqual(Buffer.from(text, charset));
  });

  it.each([
    ['latin1', 'a’b', 'U+2019'],
    // Node writes its low byte, 0x0D: the end of an HL7 segment.
    ['latin1', 'PID|č', 'U+010D'],
    ['latin1', '😀', 'U+1F600'],
    ['ascii', 'café', 'U+00E9'],
    ['utf-8', 'x\ud83dy', 'U+D83D'],
  ] as const)('refuses text that %s cannot hold (%j)', (charset, text, character) => {
    expect(() => encodeText(text, charset)).toThrow(`The text holds the character ${character}, which the charset ${charset} does not have`);
  });

  it('quotes no more of the text than that character', () => {
    expect(() => encodeText('SECRET’NAME', 'latin1')).toThrow(/^(?!.*(SECRET|NAME)).*$/);
  });
});
