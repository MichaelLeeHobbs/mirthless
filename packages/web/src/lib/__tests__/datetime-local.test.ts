import { describe, it, expect } from 'vitest';
import { fromDateTimeLocal, toDateTimeLocal } from '../datetime-local.js';

describe('toDateTimeLocal', () => {
  it('gives a datetime-local value in local time, with its seconds', () => {
    const local = new Date(2026, 9, 7, 4, 5, 6);
    expect(toDateTimeLocal(local.toISOString())).toBe('2026-10-07T04:05:06');
  });

  it('gives a blank for no time and for one it cannot read', () => {
    expect(toDateTimeLocal(null)).toBe('');
    expect(toDateTimeLocal('not a time')).toBe('');
  });
});

describe('fromDateTimeLocal', () => {
  it('gives back the instant toDateTimeLocal was given, to the second', () => {
    const iso = '2026-10-27T14:05:42.000Z';
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
  });

  it('reads a value without seconds', () => {
    expect(fromDateTimeLocal('2026-10-07T04:05')).toBe(new Date(2026, 9, 7, 4, 5).toISOString());
  });

  it('reads a blank as no time', () => {
    expect(fromDateTimeLocal('  ')).toBeNull();
  });

  it('returns undefined for a value it cannot read', () => {
    expect(fromDateTimeLocal('not a date')).toBeUndefined();
  });
});
