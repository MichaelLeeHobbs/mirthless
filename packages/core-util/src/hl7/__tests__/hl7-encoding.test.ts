import { describe, it, expect } from 'vitest';
import {
  detectEncoding, encodingCharsString, escapeValue, hexEscapeCharset, unescapeValue, type Hl7Encoding,
} from '../hl7-encoding.js';

function standardEncoding(): Hl7Encoding {
  return {
    fieldSep: '|',
    componentSep: '^',
    repetitionSep: '~',
    escapeChar: '\\',
    subComponentSep: '&',
    segmentSep: '\r',
  };
}

describe('detectEncoding', () => {
  it('detects standard delimiters from MSH', () => {
    const enc = detectEncoding('MSH|^~\\&|SENDER|FACILITY');

    expect(enc.fieldSep).toBe('|');
    expect(enc.componentSep).toBe('^');
    expect(enc.repetitionSep).toBe('~');
    expect(enc.escapeChar).toBe('\\');
    expect(enc.subComponentSep).toBe('&');
    expect(enc.segmentSep).toBe('\r');
  });

  it('detects custom delimiters', () => {
    const enc = detectEncoding('MSH#@!$%#SENDER');

    expect(enc.fieldSep).toBe('#');
    expect(enc.componentSep).toBe('@');
    expect(enc.repetitionSep).toBe('!');
    expect(enc.escapeChar).toBe('$');
    expect(enc.subComponentSep).toBe('%');
  });

  it('throws for invalid MSH segment', () => {
    expect(() => detectEncoding('PID|1||12345')).toThrow('Invalid MSH segment');
    expect(() => detectEncoding('')).toThrow('Invalid MSH segment');
  });

  it('refuses an MSH-2 with fewer than three characters rather than reading the field separator as one (#187)', () => {
    expect(() => detectEncoding('MSH|^~|A|B')).toThrow('Invalid MSH-2 encoding characters');
    expect(() => detectEncoding('MSH||A')).toThrow('Invalid MSH-2 encoding characters');
  });

  it('accepts a three-character MSH-2 with no subcomponent separator, as Mirth reads it', () => {
    // Legacy senders omit the fourth character. The field separator stands in,
    // since a field never contains it.
    const enc = detectEncoding('MSH|^~\\|A|B');
    expect(enc.escapeChar).toBe('\\');
    expect(enc.subComponentSep).toBe('|');
    expect(encodingCharsString(enc)).toBe('^~\\');
  });

  it('refuses an MSH-2 with more than five characters', () => {
    expect(() => detectEncoding('MSH|^~\\&#X|A')).toThrow('Invalid MSH-2 encoding characters');
  });

  it('refuses an MSH-2 that repeats a character', () => {
    expect(() => detectEncoding('MSH|^^\\&|A')).toThrow('Invalid MSH-2 encoding characters');
  });

  it('refuses a line break as the field separator', () => {
    expect(() => detectEncoding('MSH\r^~\\&')).toThrow('Invalid MSH segment');
  });

  it('accepts the v2.7 truncation character as a fifth encoding character', () => {
    const enc = detectEncoding('MSH|^~\\&#|SENDER');
    expect(enc.subComponentSep).toBe('&');
  });

  it('accepts a header that ends right after MSH-2', () => {
    expect(detectEncoding('MSH|^~\\&').subComponentSep).toBe('&');
    expect(detectEncoding('MSH|^~\\&\rPID|1').subComponentSep).toBe('&');
    expect(detectEncoding('MSH|^~\\&\nPID|1').subComponentSep).toBe('&');
  });
});

describe('escapeValue', () => {
  const enc = standardEncoding();

  it('escapes field separator', () => {
    expect(escapeValue('value|with|pipes', enc)).toBe('value\\F\\with\\F\\pipes');
  });

  it('escapes component separator', () => {
    expect(escapeValue('A^B', enc)).toBe('A\\S\\B');
  });

  it('escapes subcomponent separator', () => {
    expect(escapeValue('A&B', enc)).toBe('A\\T\\B');
  });

  it('escapes repetition separator', () => {
    expect(escapeValue('A~B', enc)).toBe('A\\R\\B');
  });

  it('escapes escape character', () => {
    expect(escapeValue('A\\B', enc)).toBe('A\\E\\B');
  });

  it('escapes carriage return', () => {
    expect(escapeValue('line1\rline2', enc)).toBe('line1\\X0D\\line2');
  });

  it('escapes line feed', () => {
    expect(escapeValue('line1\nline2', enc)).toBe('line1\\X0A\\line2');
  });
});

describe('unescapeValue', () => {
  const enc = standardEncoding();

  it('unescapes field separator', () => {
    expect(unescapeValue('value\\F\\with\\F\\pipes', enc)).toBe('value|with|pipes');
  });

  it('unescapes component separator', () => {
    expect(unescapeValue('A\\S\\B', enc)).toBe('A^B');
  });

  it('unescapes subcomponent separator', () => {
    expect(unescapeValue('A\\T\\B', enc)).toBe('A&B');
  });

  it('unescapes repetition separator', () => {
    expect(unescapeValue('A\\R\\B', enc)).toBe('A~B');
  });

  it('unescapes escape character', () => {
    expect(unescapeValue('A\\E\\B', enc)).toBe('A\\B');
  });

  it('unescapes hex CR', () => {
    expect(unescapeValue('line1\\X0D\\line2', enc)).toBe('line1\rline2');
  });

  it('unescapes hex LF', () => {
    expect(unescapeValue('line1\\X0A\\line2', enc)).toBe('line1\nline2');
  });

  it('unescapes arbitrary hex sequences', () => {
    expect(unescapeValue('\\X1B\\', enc)).toBe('\x1B');
  });
});

describe('round-trip escape/unescape', () => {
  const enc = standardEncoding();

  it('preserves original value through escape then unescape', () => {
    const original = 'test|value^with&all~special\\chars';
    const escaped = escapeValue(original, enc);
    const unescaped = unescapeValue(escaped, enc);

    expect(unescaped).toBe(original);
  });
});

describe('unescapeValue round trip', () => {
  const enc = detectEncoding('MSH|^~\\&|');

  it('decodes text that itself looks like an escape sequence', () => {
    // The literal text \F\ is encoded as \E\F\E\ and must come back unchanged.
    for (const text of ['\\F\\', '\\S\\ and \\T\\', 'a\\E\\b', '\\X0D\\', 'C:\\Files\\Report']) {
      expect(unescapeValue(escapeValue(text, enc), enc)).toBe(text);
    }
  });

  it('leaves an unknown sequence as it is', () => {
    expect(unescapeValue('a\\H\\bold\\N\\', enc)).toBe('a\\H\\bold\\N\\');
  });
});

describe('unescapeValue hex escapes (#194)', () => {
  const enc = standardEncoding();
  const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
  const hex = (b: number): string => `\\X${b.toString(16).toUpperCase().padStart(2, '0')}\\`;

  it('reads every byte from 0x80 to 0x9F as Windows-1252 by default', () => {
    const bytes = Array.from({ length: 32 }, (_, i) => 0x80 + i);
    // WHATWG windows-1252; the five undefined bytes (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their C1 code points.
    const expected = cp(
      0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039, 0x152, 0x8D, 0x17D, 0x8F,
      0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178,
    );
    expect(unescapeValue(bytes.map(hex).join('-'), enc)).toBe([...expected].join('-'));
    expect(unescapeValue('\\X93\\q\\X94\\', enc)).toBe(cp(0x201C) + 'q' + cp(0x201D));
  });

  it('reads 0xA0 to 0xFF and ASCII bytes as Latin-1 by default', () => {
    expect(unescapeValue('caf\\XE9\\ \\XA0\\\\XFF\\ \\X41\\', enc)).toBe(`caf${cp(0xE9)} ${cp(0xA0, 0xFF)} A`);
  });

  it('decodes the bytes of an escape as UTF-8 when the charset is UTF-8', () => {
    expect(unescapeValue('caf\\XC3A9\\', enc, 'utf-8')).toBe(`caf${cp(0xE9)}`);
    expect(unescapeValue('\\XE28099\\ \\XF09F9880\\', enc, 'utf-8')).toBe(`${cp(0x2019)} ${cp(0x1F600)}`);
  });

  it('joins adjacent hex escapes into one byte run, so a character split across escapes decodes', () => {
    expect(unescapeValue('caf\\XC3\\\\XA9\\', enc, 'utf-8')).toBe(`caf${cp(0xE9)}`);
    expect(unescapeValue('\\X0D\\\\X0A\\', enc, 'utf-8')).toBe('\r\n');
  });

  it('reads a run that is not valid UTF-8 byte by byte as Windows-1252, so no byte is lost', () => {
    expect(unescapeValue('caf\\XE9\\', enc, 'utf-8')).toBe(`caf${cp(0xE9)}`);
    expect(unescapeValue('a\\XC3\\b', enc, 'utf-8')).toBe(`a${cp(0xC3)}b`);
    expect(unescapeValue('\\X93\\q\\X94\\', enc, 'utf-8')).toBe(cp(0x201C) + 'q' + cp(0x201D));
  });

  it('keeps a UTF-8 byte order mark as U+FEFF rather than dropping it', () => {
    expect(unescapeValue('\\XEFBBBF\\x', enc, 'utf-8')).toBe(`${cp(0xFEFF)}x`);
  });

  it('chooses UTF-8 only for the UTF-8 spellings of MSH-18, and Windows-1252 for everything else', () => {
    for (const utf8 of ['UNICODE UTF-8', ' Unicode_UTF8 ', 'UTF 8', 'utf-8']) {
      expect(hexEscapeCharset(utf8)).toBe('utf-8');
    }
    for (const other of [undefined, '', 'ASCII', '8859/1', '8859/15', 'UNICODE UTF-16']) {
      expect(hexEscapeCharset(other)).toBe('windows-1252');
    }
  });

  it('reads plain UNICODE in MSH-18 as UTF-8, as HAPI and nHapi read it', () => {
    expect(hexEscapeCharset('UNICODE')).toBe('utf-8');
    expect(hexEscapeCharset(' unicode ')).toBe('utf-8');
  });

  it('reads the four-digit escapes HAPI writes for a line break as CR and LF, not a NUL before each', () => {
    for (const charset of ['windows-1252', 'utf-8'] as const) {
      expect(unescapeValue('a\\X000D\\b\\X000a\\c', enc, charset)).toBe('a\rb\nc');
      expect(unescapeValue('\\X000d\\\\X000a\\', enc, charset)).toBe('\r\n');
      expect(unescapeValue('\\X000D000A\\', enc, charset)).toBe('\r\n');
    }
  });

  it('changes no other four-digit escape that holds a line break byte', () => {
    expect(unescapeValue('\\X0D00\\', enc)).toBe('\r\0');
    expect(unescapeValue('\\X000D41\\', enc)).toBe('\0\rA');
  });

  it('decodes the single-character escapes the same way under UTF-8', () => {
    expect(unescapeValue('a\\F\\b\\E\\c\\X0D\\', enc, 'utf-8')).toBe('a|b\\c\r');
  });

  it('leaves malformed hex escapes as literal text', () => {
    for (const text of ['\\XABC\\', '\\X\\', '\\XZZ\\']) {
      expect(unescapeValue(text, enc, 'utf-8')).toBe(text);
      expect(unescapeValue(text, enc)).toBe(text);
    }
  });

  it('accepts lower-case hex digits and several bytes in one escape', () => {
    expect(unescapeValue('\\Xc3a9\\', enc, 'utf-8')).toBe(cp(0xE9));
    expect(unescapeValue('\\X0D0A\\', enc)).toBe('\r\n');
  });

  it('never reads an escaped escape character as the start of a hex escape', () => {
    expect(unescapeValue('\\E\\XC3\\', enc, 'utf-8')).toBe('\\XC3\\');
  });

  it('does not join hex escapes that another escape separates', () => {
    expect(unescapeValue('\\XC3\\\\E\\\\XA9\\', enc, 'utf-8')).toBe(`${cp(0xC3)}\\${cp(0xA9)}`);
  });

  it('reads four digits as two bytes when the sender is not said to write code points', () => {
    expect(unescapeValue('\\X2019\\', enc)).toBe(' \x19');
    expect(unescapeValue('\\X2264\\', enc, 'utf-8')).toBe('"d');
  });
});

describe('unescapeValue for a sender that writes code points (#194)', () => {
  const enc = standardEncoding();
  const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
  const read = (text: string, charset: 'utf-8' | 'windows-1252' = 'windows-1252'): string => unescapeValue(text, enc, charset, true);

  it('reads an escape of four digits as one code point, whatever the charset', () => {
    for (const charset of ['windows-1252', 'utf-8'] as const) {
      expect(read('the patient\\X2019\\s', charset)).toBe(`the patient${cp(0x2019)}s`);
      expect(read('dose \\X2264\\ 5 mg', charset)).toBe(`dose ${cp(0x2264)} 5 mg`);
    }
  });

  it('reads eight or twelve digits as two or three code points', () => {
    expect(read('\\X201C201D\\')).toBe(cp(0x201C, 0x201D));
    expect(read('\\X00E920190041\\', 'utf-8')).toBe(cp(0xE9, 0x2019, 0x41));
  });

  it('joins a surrogate pair written as two escapes into one character', () => {
    expect(read('\\XD83D\\\\XDE00\\')).toBe(cp(0x1F600));
    expect(read('\\XD83DDE00\\', 'utf-8')).toBe(cp(0x1F600));
  });

  it('joins a surrogate pair under UTF-8 too, though each half alone is also valid UTF-8', () => {
    expect(read('\\XD83D\\\\XDC89\\', 'utf-8')).toBe(cp(0x1F489));
    expect(read('\\XD83E\\\\XDDA0\\', 'utf-8')).toBe(cp(0x1F9A0));
    expect(read('\\XD880\\\\XDC80\\', 'utf-8')).toBe(cp(0x30080));
    expect(read('\\XD880DC80\\', 'utf-8')).toBe(cp(0x30080));
    expect(read('a\\XD8A7\\\\XDE00\\b', 'utf-8')).toBe(`a${cp(0x39E00)}b`);
  });

  it('reads a surrogate half with no partner beside it as UTF-8 under UTF-8 when its digits are valid UTF-8', () => {
    expect(read('\\XD8A7\\', 'utf-8')).toBe(cp(0x627));
    expect(read('\\XDC89\\\\X2019\\', 'utf-8')).toBe(cp(0x709, 0x2019));
  });

  it('keeps code-point escapes that would leave half a surrogate pair as they were written, so nothing is replaced', () => {
    expect(read('a\\XD83D\\b')).toBe('a\\XD83D\\b');
    expect(read('\\XDE00\\\\X2019\\')).toBe('\\XDE00\\\\X2019\\');
    expect(read('\\X2019\\\\XA0\\\\XD83D\\')).toBe(`${cp(0x2019, 0xA0)}\\XD83D\\`);
  });

  it('reads two-digit escapes beside code points by the charset, so a sender that mixes the forms reads right', () => {
    expect(read('\\XA0\\the patient\\X2019\\s \\X93\\chart')).toBe(`${cp(0xA0)}the patient${cp(0x2019)}s ${cp(0x201C)}chart`);
    expect(read('\\X2019\\\\X93\\\\X94\\')).toBe(cp(0x2019, 0x201C, 0x201D));
    expect(read('\\XC3\\\\XA9\\\\X2019\\', 'utf-8')).toBe(cp(0xE9, 0x2019));
  });

  it('reads an escape of six digits as three bytes', () => {
    expect(read('\\XE28099\\', 'utf-8')).toBe(cp(0x2019));
    expect(read('\\X414243\\')).toBe('ABC');
  });

  it('keeps a run made only of 0D and 0A as line breaks', () => {
    expect(read('a\\X0D0A\\b')).toBe('a\r\nb');
    expect(read('\\X0A0D0A0D\\', 'utf-8')).toBe('\n\r\n\r');
    expect(read('\\X000D\\\\X2019\\\\X000a\\')).toBe(`\r${cp(0x2019)}\n`);
  });

  it('reads an escape as UTF-8 when the charset is UTF-8 and its digits are valid UTF-8 with a byte of 0x80 or more', () => {
    expect(read('Ren\\XC3A9\\', 'utf-8')).toBe(`Ren${cp(0xE9)}`);
    expect(read('\\XE28099E28099\\', 'utf-8')).toBe(cp(0x2019, 0x2019));
    expect(read('Ren\\XC3A9\\\\X2019\\', 'utf-8')).toBe(`Ren${cp(0xE9, 0x2019)}`);
  });

  it('reads the same digits as a code point when the charset is not UTF-8', () => {
    expect(read('Ren\\XC3A9\\')).toBe(`Ren${cp(0xC3A9)}`);
  });

  it('leaves the single-character escapes and malformed hex escapes as before', () => {
    expect(read('a\\F\\b\\E\\c\\XABC\\')).toBe('a|b\\c\\XABC\\');
  });
});
