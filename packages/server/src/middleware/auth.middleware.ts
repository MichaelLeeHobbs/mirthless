// ===========================================
// Auth Middleware
// ===========================================
// Verifies JWT tokens and attaches user info to request.

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { db } from '../lib/db.js';
import { users } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { isSessionLive } from '../lib/session-live.js';
import { permissionNamesForRole } from '../lib/role-permissions.js';
import logger from '../lib/logger.js';
import { deny, DENY_REASON } from './permission.middleware.js';

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
    deny(req, res, DENY_REASON.NO_CREDENTIALS);
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
      deny(req, res, DENY_REASON.USER_NOT_FOUND);
      return;
    }

    if (!user.enabled) {
      deny(req, res, DENY_REASON.ACCOUNT_DISABLED, user.id);
      return;
    }

    // Reject tokens whose session was revoked (logout / password reset).
    if (!(await isSessionLive(payload.sessionId, user.id))) {
      deny(req, res, DENY_REASON.SESSION_REVOKED, user.id);
      return;
    }

    // Enforce forced password change server-side. Until the user changes their
    // password, every endpoint except the change-password/logout calls is blocked
    // — otherwise the flag is cosmetic (UI-only) and a known default credential
    // (e.g. the seeded admin) grants full API access indefinitely.
    if (user.mustChangePassword && !isPasswordChangeExempt(req)) {
      deny(req, res, DENY_REASON.PASSWORD_CHANGE_REQUIRED, user.id);
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
    req.sessionId = payload.sessionId;
    next();
  } catch (error) {
    logger.debug({ errMsg: error instanceof Error ? error.message : String(error) }, 'Token verification failed');
    deny(req, res, DENY_REASON.BAD_TOKEN);
  }
}
