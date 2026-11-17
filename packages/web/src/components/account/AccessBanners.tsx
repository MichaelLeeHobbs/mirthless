// ===========================================
// Access Banners
// ===========================================
// Two notices above every page (D-310, plan sections 4 and 8):
// - "Your access changed": a refresh after a refused or missing record found
//   the user's grants had changed, so "not found" may mean "not yours now".
// - "Your temporary access ends at ...": an hour before a time-limited grant
//   ends. When it ends the client refreshes, which updates the screens.

import { useEffect, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import { useAuthStore } from '../../stores/auth.store.js';
import { checkAccess } from '../../api/client.js';
import { MAX_TIMER_MS, expiryState, nextTimerDelay } from '../../lib/access-expiry.js';
import { formatTimestamp } from '../../lib/format.js';

/** The refresh at the end is spread over this long, so open tabs do not rotate the shared session together. */
const EXPIRY_JITTER_MS = 30_000;
/** How long to wait before asking again while the server still reports the same end (a fast clock, a failed refresh). */
const EXPIRY_RETRY_MS = 60_000;
const EXPIRY_RETRIES = 5;

/** The current time, moved on when the warning moment or the end comes. */
function useExpiryClock(nextExpiryAt: string | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const state = expiryState(nextExpiryAt, Date.now());
    if (state === null) return undefined;
    const timer = setTimeout(() => { setNow(Date.now()); }, nextTimerDelay(state.endsAt, Date.now()));
    return () => { clearTimeout(timer); };
  }, [nextExpiryAt, now]);
  return now;
}

/**
 * At the end of temporary access, refresh so the screens follow the narrower
 * access; ask again a few times while the server still reports the same end.
 */
function useRefreshAtExpiry(nextExpiryAt: string | null | undefined): void {
  useEffect(() => {
    const endsAt = nextExpiryAt ? Date.parse(nextExpiryAt) : Number.NaN;
    if (Number.isNaN(endsAt)) return undefined;
    const delay = Math.max(endsAt - Date.now(), 0) + Math.random() * EXPIRY_JITTER_MS;
    // A grant weeks away is checked again at the next sign-in or reload.
    if (delay > MAX_TIMER_MS) return undefined;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = (): void => {
      void checkAccess(true).then(() => {
        attempts += 1;
        if (useAuthStore.getState().user?.nextExpiryAt === nextExpiryAt && attempts < EXPIRY_RETRIES) timer = setTimeout(attempt, EXPIRY_RETRY_MS);
      });
    };
    timer = setTimeout(attempt, delay);
    return () => { clearTimeout(timer); };
  }, [nextExpiryAt]);
}

export function AccessBanners(): ReactNode {
  const nextExpiryAt = useAuthStore((s) => s.user?.nextExpiryAt);
  const accessChangedAt = useAuthStore((s) => s.accessChangedAt);
  const setAccessChanged = useAuthStore((s) => s.setAccessChanged);
  const now = useExpiryClock(nextExpiryAt);
  useRefreshAtExpiry(nextExpiryAt);
  const expiry = expiryState(nextExpiryAt, now);

  if (accessChangedAt === null && !expiry?.warn) return null;
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {accessChangedAt !== null && (
        <Alert severity="info" onClose={() => { setAccessChanged(null); }}>
          Your access changed at {formatTimestamp(accessChangedAt, { empty: 'just now' })}. A page or channel that is not found may now be outside your access.
        </Alert>
      )}
      {expiry?.warn === true && (
        <Alert severity="warning">
          Your temporary access ends at {formatTimestamp(new Date(expiry.endsAt).toISOString(), { empty: 'soon' })}.
        </Alert>
      )}
    </Stack>
  );
}
