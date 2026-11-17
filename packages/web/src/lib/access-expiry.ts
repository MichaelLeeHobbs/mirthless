// ===========================================
// Temporary access timing
// ===========================================
// The banner an hour before a temporary grant ends, and the refresh when it
// ends (D-310, plan section 4). Times are milliseconds since the epoch.

/** How long before a temporary grant ends the banner shows. */
export const EXPIRY_WARNING_MS = 60 * 60 * 1000;

/** The longest delay setTimeout honours; a later moment is waited for in steps. */
export const MAX_TIMER_MS = 2_147_483_647;

/** What the banner shows at `now` for an access ending at `nextExpiryAt`. */
export function expiryState(nextExpiryAt: string | null | undefined, now: number): { readonly endsAt: number; readonly warn: boolean } | null {
  if (!nextExpiryAt) return null;
  const endsAt = Date.parse(nextExpiryAt);
  if (Number.isNaN(endsAt) || endsAt <= now) return null;
  return { endsAt, warn: endsAt - now <= EXPIRY_WARNING_MS };
}

/**
 * How long to wait before the next change: the warning moment, then the end.
 * Never past what setTimeout honours, and never less than a second.
 */
export function nextTimerDelay(endsAt: number, now: number): number {
  const warnAt = endsAt - EXPIRY_WARNING_MS;
  const target = now < warnAt ? warnAt : endsAt;
  return Math.min(Math.max(target - now, 1000), MAX_TIMER_MS);
}
