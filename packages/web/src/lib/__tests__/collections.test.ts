import { describe, it, expect } from 'vitest';
import {
  formatTtl,
  parseFields,
  fieldColumn,
  nextSort,
  toDateTimeLocal,
  fromDateTimeLocal,
  filledFields,
  payloadPreview,
} from '../collections.js';

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

describe('nextSort', () => {
  it('flips the direction when the same column is clicked again', () => {
    expect(nextSort({ sort: 'createdAt', order: 'desc' }, 'createdAt')).toEqual({ sort: 'createdAt', order: 'asc' });
    expect(nextSort({ sort: 'payload', order: 'asc' }, 'payload')).toEqual({ sort: 'payload', order: 'desc' });
  });

  it('starts a text column A-Z and a date column newest first', () => {
    expect(nextSort({ sort: 'createdAt', order: 'desc' }, fieldColumn('accession'))).toEqual({ sort: 'fields.accession', order: 'asc' });
    expect(nextSort({ sort: 'payload', order: 'asc' }, 'expireAt')).toEqual({ sort: 'expireAt', order: 'desc' });
  });
});

describe('toDateTimeLocal / fromDateTimeLocal', () => {
  it('round-trips an instant through the local datetime input to the minute', () => {
    const iso = '2026-10-27T14:05:00.000Z';
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
  });

  it('treats blank as never expiring', () => {
    expect(toDateTimeLocal(null)).toBe('');
    expect(fromDateTimeLocal('  ')).toBeNull();
  });

  it('returns undefined for a value it cannot read', () => {
    expect(fromDateTimeLocal('not a date')).toBeUndefined();
  });
});

describe('filledFields', () => {
  it('drops blank values and keeps the rest as typed', () => {
    expect(filledFields({ accession: 'A1', facility: '  ', mrn: ' 42 ' })).toEqual({ accession: 'A1', mrn: ' 42 ' });
  });
});

describe('payloadPreview', () => {
  it('puts HL7 segments and JSON on one line', () => {
    expect(payloadPreview('MSH|^~\\&\rPID|1\n')).toBe('MSH|^~\\& PID|1');
  });

  it('shows nothing for a null payload', () => {
    expect(payloadPreview(null)).toBe('');
  });
});
