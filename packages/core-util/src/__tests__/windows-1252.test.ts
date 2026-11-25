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

  it('reads a large payload whole, in order', () => {
    const bytes = new Uint8Array(256 * 1000 + 7).map((_, i) => i % 256);

    expect(decodeWindows1252(bytes)).toBe(decodeWindows1252(EVERY_BYTE).repeat(1000) + decodeWindows1252(EVERY_BYTE).slice(0, 7));
  });

  it('reads only the bytes a view covers', () => {
    expect(decodeWindows1252(Buffer.from([0x41, 0x93, 0x42]).subarray(1, 2))).toBe('“');
  });
});
