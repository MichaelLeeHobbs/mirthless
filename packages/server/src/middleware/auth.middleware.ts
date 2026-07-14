// ===========================================
// Auth Middleware
// ===========================================
// Verifies JWT tokens and attaches user info to request.

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { db } from '../lib/db.js';
import { users, sessions } from '../db/schema/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { permissionNamesForRole } from '../lib/role-permissions.js';
import logger from '../lib/logger.js';

/**
 * True when the token's session still exists and has not expired. Logout and
 * admin password-reset delete the session row, so this makes an access token stop
 * working immediately on logout instead of lingering until its 15-minute TTL.
 * Tokens minted without a sessionId (should not happen for access tokens) pass.
 */
async function isSessionLive(sessionId: string | undefined, userId: string): Promise<boolean> {
  if (sessionId === undefined) return true;
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return row !== undefined;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: {
        id: string;
        username: string;
        email: string;
        role: string;
        isActive: boolean;
        permissions: readonly string[];
        mustChangePassword: boolean;
      };
      sessionId?: string;
    }
  }
}

/**
 * Endpoints an authenticated user may still call while `mustChangePassword` is set:
 * changing their own password (the whole point) and logging out. Everything else
 * is blocked until the password is changed.
 */
function isPasswordChangeExempt(req: Request): boolean {
  const url = req.originalUrl.split('?')[0] ?? '';
  if (req.method === 'POST' && url.endsWith('/users/me/password')) return true;
  if (req.method === 'POST' && url.endsWith('/auth/logout')) return true;
  return false;
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);

    // Fetch user from database to get current status
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        enabled: users.enabled,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, payload.userId));

    if (!user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not found' } });
      return;
    }

    if (!user.enabled) {
      res.status(403).json({ success: false, error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is deactivated' } });
      return;
    }

    // Reject tokens whose session was revoked (logout / password reset).
    if (!(await isSessionLive(payload.sessionId, user.id))) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session expired or revoked' } });
      return;
    }

    // Enforce forced password change server-side. Until the user changes their
    // password, every endpoint except the change-password/logout calls is blocked
    // — otherwise the flag is cosmetic (UI-only) and a known default credential
    // (e.g. the seeded admin) grants full API access indefinitely.
    if (user.mustChangePassword && !isPasswordChangeExempt(req)) {
      res.status(403).json({
        success: false,
        error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your password before continuing.' },
      });
      return;
    }

    // Resolve permissions live from the user's role (single source of truth —
    // adding a permission to a role reaches existing users without a re-sync).
    const permissions = permissionNamesForRole(user.role);

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.enabled,
      permissions,
      mustChangePassword: user.mustChangePassword,
    };
    if (payload.sessionId) {
      req.sessionId = payload.sessionId;
    }
    next();
  } catch (error) {
    logger.debug({ errMsg: error instanceof Error ? error.message : String(error) }, 'Token verification failed');
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}

/**
 * Optional auth — attaches user if token present but doesn't fail if absent.
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        enabled: users.enabled,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, payload.userId));

    if (user && user.enabled) {
      const permissions = permissionNamesForRole(user.role);

      req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.enabled,
        permissions,
        mustChangePassword: user.mustChangePassword,
      };
      if (payload.sessionId) {
        req.sessionId = payload.sessionId;
      }
    }
  } catch {
    // Ignore invalid tokens for optional auth
  }

  next();
}
