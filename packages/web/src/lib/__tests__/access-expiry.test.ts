import { describe, it, expect } from 'vitest';
import { MAX_TIMER_DELAY_MS } from '@galvanigraph/core-models';
import { EXPIRY_WARNING_MS, expiryState, nextTimerDelay } from '../access-expiry.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');

describe('expiryState', () => {
  it('shows nothing for permanent access, an unreadable time or one already past', () => {
    expect(expiryState(null, NOW)).toBeNull();
    expect(expiryState('nonsense', NOW)).toBeNull();
    expect(expiryState('2026-11-17T11:00:00Z', NOW)).toBeNull();
  });

  it('warns within the last hour, and not before', () => {
    expect(expiryState('2026-11-17T12:30:00Z', NOW)).toEqual({ endsAt: Date.parse('2026-11-17T12:30:00Z'), warn: true });
    expect(expiryState('2026-11-17T14:00:00Z', NOW)?.warn).toBe(false);
  });
});

describe('nextTimerDelay', () => {
  it('waits for the warning moment, then for the end', () => {
    const endsAt = NOW + 3 * EXPIRY_WARNING_MS;
    expect(nextTimerDelay(endsAt, NOW)).toBe(2 * EXPIRY_WARNING_MS);
    expect(nextTimerDelay(endsAt, endsAt - 1000 * 60)).toBe(1000 * 60);
  });

  it('never waits past what setTimeout honours, nor less than a second', () => {
    expect(nextTimerDelay(NOW + 90 * 24 * 3600 * 1000, NOW)).toBe(MAX_TIMER_DELAY_MS);
    expect(nextTimerDelay(NOW + 10, NOW)).toBe(1000);
  });
});
