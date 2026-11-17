// ===========================================
// Auth Middleware
// ===========================================
// Verifies JWT tokens and attaches user info to request.

import type { Request, Response, NextFunction } from 'express';
import type { ChannelGroupId, FoldedGrants } from '@galvanigraph/core-models';
import { verifyAccessToken } from '../lib/jwt.js';
import { isSessionLive } from '../lib/session-live.js';
import { loadUserStanding, roleLabel } from '../lib/principal.js';
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
        /** The held role names joined, for records and screens that show one role. */
        role: string;
        isActive: boolean;
        permissions: readonly string[];
        mustChangePassword: boolean;
      };
      sessionId?: string;
      /** Who is acting and what they hold on which channels (D-310). Set by authenticate. */
      principal?: {
        readonly userId: string;
        readonly grants: FoldedGrants;
      };
      /** The groups of the channel the route names, read by scopeToChannel; absent when no check is needed. */
      channelScope?: readonly ChannelGroupId[];
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

    // The user's current standing and grants, in one query (lib/principal.ts).
    const user = await loadUserStanding(payload.userId);

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

    // Grants are resolved live from the user's assignments on every request, so
    // a role edit, an assignment change or an expiry takes effect at once.
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: roleLabel(user.roles),
      isActive: user.enabled,
      permissions: user.permissions,
      mustChangePassword: user.mustChangePassword,
    };
    req.sessionId = payload.sessionId;
    req.principal = { userId: user.id, grants: user.grants };
    next();
  } catch (error) {
    logger.debug({ errMsg: error instanceof Error ? error.message : String(error) }, 'Token verification failed');
    deny(req, res, DENY_REASON.BAD_TOKEN);
  }
}
