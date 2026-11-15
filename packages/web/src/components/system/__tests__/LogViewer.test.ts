import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatTimestamp } from '../LogViewer.js';

// Node reads TZ on every Date call, so each block sets the zone it means.
const ORIGINAL_TZ = process.env['TZ'];
function inZone(zone: string): void {
  beforeEach(() => { process.env['TZ'] = zone; });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ORIGINAL_TZ;
  });
}

const VALID = '2026-06-15T14:05:09.042Z';
// The type says string, but a log line from the wire can lack a time.
const missing = (v: null | undefined): string => v as unknown as string;

describe('log line time of day in UTC', () => {
  inZone('UTC');

  it('shows HH:MM:SS.mmm for a valid time', () => {
    expect(formatTimestamp(VALID)).toBe('14:05:09.042');
  });

  it('shows the epoch for null', () => {
    expect(formatTimestamp(missing(null))).toBe('00:00:00.000');
  });

  it('shows NaN digits for undefined, an empty string or an unparseable value', () => {
    for (const value of [missing(undefined), '', 'not-a-date']) {
      expect(formatTimestamp(value)).toBe('NaN:NaN:NaN.NaN');
    }
  });
});

describe('log line time of day in America/New_York', () => {
  inZone('America/New_York');

  it('shows HH:MM:SS.mmm in the local zone for a valid time', () => {
    expect(formatTimestamp(VALID)).toBe('10:05:09.042');
  });

  it('shows the epoch in New York for null', () => {
    expect(formatTimestamp(missing(null))).toBe('19:00:00.000');
  });

  it('shows NaN digits for undefined, an empty string or an unparseable value', () => {
    for (const value of [missing(undefined), '', 'not-a-date']) {
      expect(formatTimestamp(value)).toBe('NaN:NaN:NaN.NaN');
    }
  });
});
