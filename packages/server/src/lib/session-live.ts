// ===========================================
// Session Liveness
// ===========================================
// Shared by the REST auth middleware and the Socket.IO server so both stop
// honoring a token as soon as its session is revoked.

import { and, eq, gt } from 'drizzle-orm';
import { db } from './db.js';
import { sessions } from '../db/schema/index.js';

/**
 * True when the token's session still exists and has not expired. Logout and
 * admin password-reset delete the session row, so this makes an access token stop
 * working immediately on logout instead of lingering until its 15-minute TTL.
 * Tokens minted without a sessionId (should not happen for access tokens) pass.
 */
export async function isSessionLive(sessionId: string | undefined, userId: string): Promise<boolean> {
  if (sessionId === undefined) return true;
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return row !== undefined;
}
