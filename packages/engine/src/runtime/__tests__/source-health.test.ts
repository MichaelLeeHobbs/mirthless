import { describe, expect, it } from 'vitest';
import { OUTAGE_OVER_AFTER_MS, OUTAGE_REPEAT_MS, SourceHealth } from '../source-health.js';

const DOWN = new Error('ECONNREFUSED');
const POLL_MS = 5_000;

/** The times at which an alert is due, for what each poll found (`.` for nothing wrong). */
function alertsFor(polls: string, everyMs = POLL_MS): readonly number[] {
  const health = new SourceHealth();
  return [...polls].flatMap((poll, i) => (health.report(poll === '.' ? null : DOWN, i * everyMs) ? [i * everyMs] : []));
}

describe('SourceHealth', () => {
  it('is due for the first failure, and not for those that follow', () => {
    expect(alertsFor('..xxxx')).toEqual([10_000]);
  });

  it('is due again each hour while it lasts, since the first alert may have been held back', () => {
    const polls = 'x'.repeat(2 * (OUTAGE_REPEAT_MS / POLL_MS) + 1);

    expect(alertsFor(polls)).toEqual([0, OUTAGE_REPEAT_MS, 2 * OUTAGE_REPEAT_MS]);
  });

  it('is due again for a failure after the source worked for a while', () => {
    const worked = '.'.repeat(OUTAGE_OVER_AFTER_MS / POLL_MS + 1);

    expect(alertsFor(`x${worked}x`)).toEqual([0, POLL_MS + OUTAGE_OVER_AFTER_MS + POLL_MS]);
  });

  it('takes a source that works now and then for one outage', () => {
    expect(alertsFor('x.x.x.xx..x.x')).toEqual([0]);
  });

  it.each([60_000, 600_000])('takes one good poll between failures for the same outage, polling every %i ms', (everyMs) => {
    expect(alertsFor('x.x.x.', everyMs)).toEqual([0]);
  });

  it.each([60_000, 600_000])('is over after two good polls in a row, polling every %i ms', (everyMs) => {
    expect(alertsFor('x..x', everyMs)).toEqual([0, 3 * everyMs]);
  });

  it('is over for a connection that was held for a while, and not for one that was lost at once', () => {
    const health = new SourceHealth();
    expect(health.report(DOWN, 0)).toBe(true);
    // Connected, and lost a second later.
    health.report(null, 10_000);
    health.report(null, 11_000);
    expect(health.report(DOWN, 11_000)).toBe(false);
    // Connected, and lost an hour later.
    health.report(null, 20_000);
    health.report(null, 120_000);
    expect(health.report(DOWN, 120_000)).toBe(true);
  });

  it('is never due for a source that works', () => {
    expect(alertsFor('....')).toEqual([]);
  });
});
