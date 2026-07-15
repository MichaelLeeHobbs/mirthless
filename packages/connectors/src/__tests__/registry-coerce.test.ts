import { describe, it, expect } from 'vitest';
import { num, readSmtpAttachments } from '../registry.js';

describe('registry num() coercion', () => {
  it('returns a numeric value as-is', () => {
    expect(num({ port: 6661 }, 'port', 0)).toBe(6661);
  });

  it('coerces a numeric string (e.g. from a JSON/UI config) to a number', () => {
    expect(num({ port: '6661' }, 'port', 0)).toBe(6661);
    expect(typeof num({ port: '6661' }, 'port', 0)).toBe('number');
  });

  it('falls back for missing, empty, null, or non-numeric values', () => {
    expect(num({}, 'port', 22)).toBe(22);
    expect(num({ port: '' }, 'port', 22)).toBe(22);
    expect(num({ port: null }, 'port', 22)).toBe(22);
    expect(num({ port: 'abc' }, 'port', 22)).toBe(22);
    expect(num({ port: undefined }, 'port', 22)).toBe(22);
  });
});

describe('registry readSmtpAttachments()', () => {
  it('returns an empty array for non-array input', () => {
    expect(readSmtpAttachments(undefined)).toEqual([]);
    expect(readSmtpAttachments(null)).toEqual([]);
    expect(readSmtpAttachments('nope')).toEqual([]);
    expect(readSmtpAttachments({})).toEqual([]);
  });

  it('maps valid entries, carrying mimeType only when a string', () => {
    const result = readSmtpAttachments([
      { filename: 'a.txt', content: 'x' },
      { filename: 'b.txt', content: 'y', mimeType: 'text/csv' },
    ]);
    expect(result).toEqual([
      { filename: 'a.txt', content: 'x' },
      { filename: 'b.txt', content: 'y', mimeType: 'text/csv' },
    ]);
  });

  it('skips malformed entries (missing/non-string filename or content, or non-object)', () => {
    const result = readSmtpAttachments([
      null,
      'string',
      { filename: 'ok.txt', content: 'keep' },
      { filename: 123, content: 'bad-name' },
      { filename: 'bad-content.txt', content: 456 },
      { content: 'no-filename' },
      { filename: 'no-content.txt' },
    ]);
    expect(result).toEqual([{ filename: 'ok.txt', content: 'keep' }]);
  });

  it('drops a non-string mimeType but keeps the entry', () => {
    const result = readSmtpAttachments([{ filename: 'a.txt', content: 'x', mimeType: 42 }]);
    expect(result).toEqual([{ filename: 'a.txt', content: 'x' }]);
  });
});
