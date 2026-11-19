// D-310. Times are milliseconds since the epoch.

export const EXPIRY_WARNING_MS = 60 * 60 * 1000;

/** The longest delay setTimeout honours; a later moment is waited for in steps. */
export const MAX_TIMER_MS = 2_147_483_647;

export function expiryState(nextExpiryAt: string | null | undefined, now: number): { readonly endsAt: number; readonly warn: boolean } | null {
  if (!nextExpiryAt) return null;
  const endsAt = Date.parse(nextExpiryAt);
  if (Number.isNaN(endsAt) || endsAt <= now) return null;
  return { endsAt, warn: endsAt - now <= EXPIRY_WARNING_MS };
}

export function nextTimerDelay(endsAt: number, now: number): number {
  const warnAt = endsAt - EXPIRY_WARNING_MS;
  const target = now < warnAt ? warnAt : endsAt;
  return Math.min(Math.max(target - now, 1000), MAX_TIMER_MS);
}
