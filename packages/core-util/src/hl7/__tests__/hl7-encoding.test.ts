// ===========================================
// HL7v2 Encoding Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { detectEncoding, escapeValue, unescapeValue, type Hl7Encoding } from '../hl7-encoding.js';

// ----- Helpers -----

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

// ----- Tests -----

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
