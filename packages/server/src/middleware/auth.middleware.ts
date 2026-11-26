import type { Request, Response, NextFunction } from 'express';
import type { ChannelGroupId, FoldedGrants } from '@galvanigraph/core-models';
import { errorInfo } from '@galvanigraph/core-util';
import { verifyAccessToken, type AccessTokenPayload } from '../lib/jwt.js';
import { errorResponse, mapErrorToStatus } from '../lib/controller-helpers.js';
import { ServiceError } from '../lib/service-error.js';
import { isSessionLive } from '../lib/session-live.js';
import { loadUserStanding, roleLabel } from '../lib/principal.js';
import logger from '../lib/logger.js';
import { deny, DENY_REASON } from './permission.middleware.js';
import { looksLikeKeyToken } from '../lib/api-key-token.js';
import { ApiKeyService } from '../services/api-key.service.js';
import type { UserStanding } from '../lib/principal.js';

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
      /** Set when the request signed in with an API key (D-313). */
      apiKeyId?: string;
      /** Set by authenticate (D-310). */
      principal?: {
        readonly userId: string;
        readonly grants: FoldedGrants;
      };
      /** The groups of the channel the route names, read by scopeToChannel; absent when no check is needed. */
      channelScope?: readonly ChannelGroupId[];
    }
  }
}

/** The only calls allowed while `mustChangePassword` is set. */
function isPasswordChangeExempt(req: Request): boolean {
  const url = req.originalUrl.split('?')[0] ?? '';
  if (req.method === 'POST' && url.endsWith('/users/me/password')) return true;
  if (req.method === 'POST' && url.endsWith('/auth/logout')) return true;
  return false;
}

/** A key token in a query string: it would land in proxy and server logs. */
const KEY_IN_URL = /gf_[0-9a-f]{8}-[0-9a-f]{4}-/i;

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

/** Every refusal answers the same 401, so a caller learns nothing about which part was wrong. */
async function authenticateKey(req: Request, res: Response, token: string): Promise<boolean> {
  const key = await ApiKeyService.resolve(token);
  if (!key) {
    deny(req, res, DENY_REASON.BAD_TOKEN);
    return false;
  }
  attach(req, key.standing);
  req.apiKeyId = key.keyId;
  noteKeyUse(key.keyId, req.ip);
  return true;
}

/** True when the request may go on; otherwise it has been answered. */
async function authenticateSession(req: Request, res: Response, payload: AccessTokenPayload): Promise<boolean> {
  const user = await loadUserStanding(payload.userId);

  if (!user) {
    deny(req, res, DENY_REASON.USER_NOT_FOUND);
    return false;
  }

  if (!user.enabled) {
    deny(req, res, DENY_REASON.ACCOUNT_DISABLED, user.id);
    return false;
  }

  if (!(await isSessionLive(payload.sessionId, user.id))) {
    deny(req, res, DENY_REASON.SESSION_REVOKED, user.id);
    return false;
  }

  // Enforced here, or the flag is cosmetic and a known default credential (the
  // seeded admin) grants full API access indefinitely.
  if (user.mustChangePassword && !isPasswordChangeExempt(req)) {
    deny(req, res, DENY_REASON.PASSWORD_CHANGE_REQUIRED, user.id);
    return false;
  }

  attach(req, user);
  req.sessionId = payload.sessionId;
  return true;
}

/**
 * The credential may be good: refusing it would sign people out and record a
 * denial that was none (#473). Nothing is attached, so the request stops here.
 */
function answerUnreadable(req: Request, res: Response, error: unknown): void {
  logger.error({ ...errorInfo(error), requestId: req.id }, 'Could not read the caller\'s credentials');
  const unavailable = new ServiceError('UNAVAILABLE', 'Credentials cannot be checked right now; try again shortly');
  res.status(mapErrorToStatus(unavailable)).json({ success: false, error: errorResponse(unavailable) });
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
  const isKey = looksLikeKeyToken(token);
  let payload: AccessTokenPayload | undefined;
  if (!isKey) {
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      logger.debug({ errMsg: error instanceof Error ? error.message : String(error) }, 'Token verification failed');
      deny(req, res, DENY_REASON.BAD_TOKEN);
      return;
    }
  }

  let passed: boolean;
  try {
    passed = payload === undefined ? await authenticateKey(req, res, token) : await authenticateSession(req, res, payload);
  } catch (error) {
    answerUnreadable(req, res, error);
    return;
  }
  if (passed) next();
}
