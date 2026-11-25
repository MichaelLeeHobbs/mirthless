import { describe, it, expect } from 'vitest';
import { decodeWindows1252 } from '../windows-1252.js';

const EVERY_BYTE = Uint8Array.from({ length: 256 }, (_, i) => i);

describe('decodeWindows1252', () => {
  it('reads every byte as the WHATWG Encoding Standard does', () => {
    const c1 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f'
      + '\u0090‘’“”•–—˜™š›œ\u009džŸ';
    const text = decodeWindows1252(EVERY_BYTE);

    expect(text.slice(0x80, 0xa0)).toBe(c1);
    expect(text.slice(0, 0x80) + text.slice(0xa0)).toBe(Buffer.from([...EVERY_BYTE.subarray(0, 0x80), ...EVERY_BYTE.subarray(0xa0)]).toString('latin1'));
  });

  it('reads no bytes as no text', () => {
    expect(decodeWindows1252(new Uint8Array())).toBe('');
  });

  // The bytes must not repeat with the 8192 it decodes at a time, or a piece read twice or out of order looks right.
  it.each([8191, 8192, 8193, 100_000])('reads %i bytes whole, in order', (length) => {
    const bytes = Buffer.alloc(length).map((_, i) => ((i % 251) + (i >> 13)) % 0x80);

    expect(decodeWindows1252(bytes) === Buffer.from(bytes).toString('latin1')).toBe(true);
  });

  it('reads the bytes on both sides of 8192 as Windows-1252', () => {
    const bytes = Buffer.alloc(16_385, 'x');
    bytes.set([0x93, 0x94], 8191);
    bytes.set([0x80, 0x96], 16_383);

    const text = decodeWindows1252(bytes);

    expect([text.length, text.slice(8190, 8194), text.slice(16_382)]).toEqual([16_385, 'x“”x', 'x€–']);
  });

  it('reads only the bytes a view covers', () => {
    expect(decodeWindows1252(Buffer.from([0x41, 0x93, 0x42]).subarray(1, 2))).toBe('“');
  });
});
