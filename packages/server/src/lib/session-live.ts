import { and, eq, gt } from 'drizzle-orm';
import { db } from './db.js';
import { sessions } from '../db/schema/index.js';

/**
 * Logout and password reset delete the session row, so an access token stops
 * working at once rather than at its expiry. A token with no sessionId is
 * refused (GHSA-r434-hwqg-cvcw).
 */
export async function isSessionLive(sessionId: string | undefined, userId: string): Promise<boolean> {
  if (sessionId === undefined || sessionId === '') return false;
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return row !== undefined;
}
