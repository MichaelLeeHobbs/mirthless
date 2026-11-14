import { describe, it, expect } from 'vitest';
import { formatTimestamp, humanize } from '../format.js';

const ISO = '2026-03-08T07:30:00Z';

describe('formatTimestamp', () => {
  it('shows a date and time in the browser locale', () => {
    expect(formatTimestamp(ISO)).toBe(new Date(ISO).toLocaleString());
  });

  it('shows only the date when asked', () => {
    expect(formatTimestamp(ISO, { dateOnly: true })).toBe(new Date(ISO).toLocaleDateString());
  });

  it('shows a dash for null, undefined or an empty string, never the 1970 epoch', () => {
    for (const value of [null, undefined, '']) {
      expect(formatTimestamp(value)).toBe('—');
    }
  });

  it('shows the caller\'s label for a missing value', () => {
    expect(formatTimestamp(null, { empty: 'Never' })).toBe('Never');
    expect(formatTimestamp('', { empty: 'Never', dateOnly: true })).toBe('Never');
  });

  it('shows an unparseable value as it came, not "Invalid Date"', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('humanize', () => {
  it('turns an upper snake case enum into sentence case', () => {
    expect(humanize('CHANNEL_ERROR')).toBe('Channel error');
  });

  it('handles kebab case, repeated separators and padding', () => {
    expect(humanize('  user--login__failed ')).toBe('User login failed');
  });

  it('capitalises a single lower case word', () => {
    expect(humanize('admin')).toBe('Admin');
  });

  it('returns an empty string for empty input', () => {
    expect(humanize('')).toBe('');
  });
});
