// ===========================================
// Auth Middleware
// ===========================================
// Verifies the bearer token, a person's JWT or an API key (D-313), and
// attaches who is acting to the request.

import type { Request, Response, NextFunction } from 'express';
import type { ChannelGroupId, FoldedGrants } from '@galvanigraph/core-models';
import { verifyAccessToken } from '../lib/jwt.js';
import { isSessionLive } from '../lib/session-live.js';
import { loadUserStanding, roleLabel } from '../lib/principal.js';
import logger from '../lib/logger.js';
import { deny, DENY_REASON } from './permission.middleware.js';
import { looksLikeKeyToken } from '../lib/api-key-token.js';
import { ApiKeyService } from '../services/api-key.service.js';
import type { UserStanding } from '../lib/principal.js';

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
      /** The API key the request signed in with, when it did (D-313). */
      apiKeyId?: string;
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

/** A key token in a query string: it would land in proxy and server logs. */
const KEY_IN_URL = /gf_[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** Whether the query string carries something shaped like a key token, encoded or not. */
export function keyInQuery(originalUrl: string): boolean {
  const at = originalUrl.indexOf('?');
  if (at < 0) return false;
  const query = originalUrl.slice(at + 1);
  if (KEY_IN_URL.test(query)) return true;
  try {
    return KEY_IN_URL.test(decodeURIComponent(query));
  } catch {
    return false;
  }
}

/** When each key's last use was written, so it is written at most once a minute. */
const lastTouched = new Map<string, number>();
const TOUCH_INTERVAL_MS = 60_000;

function noteKeyUse(keyId: string, ip: string | undefined): void {
  const now = Date.now();
  if (now - (lastTouched.get(keyId) ?? 0) < TOUCH_INTERVAL_MS) return;
  lastTouched.set(keyId, now);
  ApiKeyService.touch(keyId, ip ?? null).catch((err: unknown) => {
    logger.warn({ errMsg: err instanceof Error ? err.message : String(err), apiKeyId: keyId }, 'Could not record an API key\'s last use');
  });
}

/** Attach a resolved principal, a person's or a key's, to the request. */
function attach(req: Request, user: UserStanding): void {
  // Grants are resolved live from the principal's assignments on every request,
  // so a role edit, an assignment change or an expiry takes effect at once.
  req.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: roleLabel(user.roles),
    isActive: user.enabled,
    permissions: user.permissions,
    mustChangePassword: user.mustChangePassword,
  };
  req.principal = { userId: user.id, grants: user.grants };
}

/**
 * Sign the request in with an API key. Every failure answers the same 401: a
 * caller learns nothing about which part was wrong.
 */
async function authenticateKey(req: Request, res: Response, next: NextFunction, token: string): Promise<void> {
  const key = await ApiKeyService.resolve(token);
  if (!key) {
    deny(req, res, DENY_REASON.BAD_TOKEN);
    return;
  }
  attach(req, key.standing);
  req.apiKeyId = key.keyId;
  noteKeyUse(key.keyId, req.ip);
  next();
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (keyInQuery(req.originalUrl)) {
    deny(req, res, DENY_REASON.BAD_TOKEN);
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    deny(req, res, DENY_REASON.NO_CREDENTIALS);
    return;
  }

  const token = authHeader.slice(7);

  try {
    if (looksLikeKeyToken(token)) {
      await authenticateKey(req, res, next, token);
      return;
    }

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

    attach(req, user);
    req.sessionId = payload.sessionId;
    next();
  } catch (error) {
    logger.debug({ errMsg: error instanceof Error ? error.message : String(error) }, 'Token verification failed');
    deny(req, res, DENY_REASON.BAD_TOKEN);
  }
}
