import { describe, it, expect } from 'vitest';
import { formatTtl, parseFields } from '../collections.js';

describe('formatTtl', () => {
  it('renders null as Never', () => {
    expect(formatTtl(null)).toBe('Never');
  });

  it('renders whole days, hours, minutes with the largest unit', () => {
    expect(formatTtl(604_800)).toBe('7d');
    expect(formatTtl(7_200)).toBe('2h');
    expect(formatTtl(300)).toBe('5m');
  });

  it('falls back to seconds for non-round values', () => {
    expect(formatTtl(90)).toBe('90s');
  });
});

describe('parseFields', () => {
  it('splits on commas and whitespace, trimming', () => {
    expect(parseFields('accessionNumber, institutionName  orderControl')).toEqual([
      'accessionNumber',
      'institutionName',
      'orderControl',
    ]);
  });

  it('dedupes repeated field names', () => {
    expect(parseFields('a, a, b')).toEqual(['a', 'b']);
  });

  it('returns an empty array for blank input', () => {
    expect(parseFields('   ')).toEqual([]);
  });
});
