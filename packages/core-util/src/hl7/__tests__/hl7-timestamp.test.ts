import { describe, it, expect, vi } from 'vitest';
import { formatTimestamp } from '../hl7-timestamp.js';

function instantOf(ts: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-])(\d{2})(\d{2})$/.exec(ts);
  if (!m) throw new Error(`not an HL7 timestamp with offset: ${ts}`);
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const offsetMinutes = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMinutes * 60_000;
}

describe('formatTimestamp', () => {
  it('formats local time as YYYYMMDDHHmmss with no offset by default', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102030405');
  });

  it('appends the UTC offset when asked, naming the same instant (#187)', () => {
    for (const date of [new Date(2026, 0, 15, 12, 30, 45), new Date(2026, 6, 15, 23, 59, 59)]) {
      const ts = formatTimestamp(date, { utcOffset: true });
      expect(ts).toMatch(/^\d{14}[+-]\d{4}$/);
      expect(instantOf(ts)).toBe(date.getTime());
    }
  });

  it('writes zones west of UTC with a minus sign and half-hour zones with their minutes', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);
    const offset = vi.spyOn(date, 'getTimezoneOffset');
    offset.mockReturnValue(300);
    expect(formatTimestamp(date, { utcOffset: true })).toBe('20260102030405-0500');
    offset.mockReturnValue(-330);
    expect(formatTimestamp(date, { utcOffset: true })).toBe('20260102030405+0530');
    offset.mockReturnValue(0);
    expect(formatTimestamp(date, { utcOffset: true })).toBe('20260102030405+0000');
  });
});
