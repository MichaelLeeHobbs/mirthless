import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatClockTime } from '../../../lib/format.js';

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

for (const [zone, clock] of [['UTC', '14:05:09.042'], ['America/New_York', '10:05:09.042']] as const) {
  describe(`log line time of day in ${zone}`, () => {
    inZone(zone);

    it('shows HH:MM:SS.mmm in the local zone for a valid time', () => {
      expect(formatClockTime(VALID)).toBe(clock);
    });

    it('shows a dash for null, undefined or an empty string, never the epoch', () => {
      for (const value of [null, undefined, '']) {
        expect(formatClockTime(value)).toBe('—');
      }
    });

    it('shows an unparseable value as it came, not NaN digits', () => {
      expect(formatClockTime('not-a-date')).toBe('not-a-date');
    });
  });
}
