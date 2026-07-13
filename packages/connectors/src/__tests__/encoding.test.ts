import { describe, it, expect } from 'vitest';
import { normalizeEncoding } from '../encoding.js';

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
