// D-310. Times are milliseconds since the epoch.

import { MAX_TIMER_DELAY_MS } from '@galvanigraph/core-models';

export const EXPIRY_WARNING_MS = 60 * 60 * 1000;

export function expiryState(nextExpiryAt: string | null | undefined, now: number): { readonly endsAt: number; readonly warn: boolean } | null {
  if (!nextExpiryAt) return null;
  const endsAt = Date.parse(nextExpiryAt);
  if (Number.isNaN(endsAt) || endsAt <= now) return null;
  return { endsAt, warn: endsAt - now <= EXPIRY_WARNING_MS };
}

/** A moment past the longest delay a timer honours is waited for in steps. */
export function nextTimerDelay(endsAt: number, now: number): number {
  const warnAt = endsAt - EXPIRY_WARNING_MS;
  const target = now < warnAt ? warnAt : endsAt;
  return Math.min(Math.max(target - now, 1000), MAX_TIMER_DELAY_MS);
}
