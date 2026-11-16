// ===========================================
// Permission Middleware
// ===========================================
// The route guards, and deny(): the one way a guard refuses a request. deny()
// answers through errorResponse and records the refusal as an ACCESS_DENIED
// event, once a minute per caller, route and reason (#158).

import type { NextFunction, Request, Response } from 'express';
import { EVENT_NAME, type Permission } from '@galvanigraph/core-models';
import { errorInfo } from '@galvanigraph/core-util';
import { ServiceError, type ServiceErrorCode } from '../lib/service-error.js';
import { errorResponse, mapErrorToStatus } from '../lib/controller-helpers.js';
import { emitEvent } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';

/** Why a request was refused. Recorded in each ACCESS_DENIED event. */
export const DENY_REASON = {
  NO_CREDENTIALS: 'no_credentials',
  BAD_TOKEN: 'bad_token',
  USER_NOT_FOUND: 'user_not_found',
  SESSION_REVOKED: 'session_revoked',
  ACCOUNT_DISABLED: 'account_disabled',
  PASSWORD_CHANGE_REQUIRED: 'password_change_required',
  NO_PERMISSION: 'no_permission',
} as const;
export type DenyReason = (typeof DENY_REASON)[keyof typeof DENY_REASON];

/** The answer for each reason. The 401 messages tell the walk tests which guard answered. */
const REFUSALS: Readonly<Record<DenyReason, readonly [ServiceErrorCode, string]>> = {
  no_credentials: ['UNAUTHORIZED', 'Unauthorized'],
  bad_token: ['UNAUTHORIZED', 'Invalid or expired token'],
  user_not_found: ['UNAUTHORIZED', 'User not found'],
  session_revoked: ['UNAUTHORIZED', 'Session expired or revoked'],
  account_disabled: ['ACCOUNT_DEACTIVATED', 'Account is deactivated'],
  password_change_required: ['PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing.'],
  no_permission: ['FORBIDDEN', 'Forbidden'],
};

// ----- Coalescing -----
// One record per caller, route and reason a minute. The keys are bounded by the
// users, the route templates and the reasons, never by the URL a caller sends:
// every anonymous refusal before routing shares one key per reason.

const WINDOW_MS = 60_000;
const MAX_WINDOWS = 10_000;

interface Window {
  readonly start: number;
  repeats: number;
}

const windows = new Map<string, Window>();

/**
 * Open a new window for `key` and return how many refusals the last one
 * dropped, or undefined while the current window is open.
 */
function openWindow(key: string, now: number): number | undefined {
  const open = windows.get(key);
  if (open && now - open.start < WINDOW_MS) {
    open.repeats += 1;
    return undefined;
  }
  if (!open && windows.size >= MAX_WINDOWS) {
    for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k);
    // Still full: every key refused within the minute. Start over rather than grow.
    if (windows.size >= MAX_WINDOWS) windows.clear();
  }
  windows.set(key, { start: now, repeats: 0 });
  return open?.repeats ?? 0;
}

/** The route template (`/api/v1/channels/:id`), or null before routing. Never the URL. */
function routeTemplate(req: Request): string | null {
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') return null;
  // A router's own '/' is the mount path itself: /api/v1/users, not /api/v1/users/.
  return path === '/' && req.baseUrl !== '' ? req.baseUrl : `${req.baseUrl}${path}`;
}

function recordRefusal(req: Request, reason: DenyReason, status: number, userId: string | undefined): void {
  const route = routeTemplate(req);
  const repeatsSinceLast = openWindow(`${userId ?? '-'}|${req.method} ${route ?? '-'}|${reason}`, Date.now());
  if (repeatsSinceLast === undefined) return;
  emitEvent({
    level: 'WARN', name: EVENT_NAME.ACCESS_DENIED, outcome: 'FAILURE',
    userId: userId ?? null, channelId: null, serverId: null, ipAddress: req.ip ?? null,
    attributes: {
      method: req.method, route, reason, status,
      principal: userId === undefined ? 'anonymous' : 'user',
      requestId: req.id ?? null, repeatsSinceLast,
    },
  });
}

/**
 * Refuse the request: answer with the reason's status and error body, then
 * record the refusal. Recording never changes the answer, and a failure to
 * record is logged, not thrown. `userId` names a caller authenticate has
 * identified but not yet signed in; it defaults to the signed-in user.
 */
export function deny(req: Request, res: Response, reason: DenyReason, userId: string | undefined = req.user?.id): void {
  const [code, message] = REFUSALS[reason];
  const error = new ServiceError(code, message);
  const status = mapErrorToStatus(error);
  res.status(status).json({ success: false, error: errorResponse(error) });
  try {
    recordRefusal(req, reason, status, userId);
  } catch (err: unknown) {
    logger.warn({ ...errorInfo(err), reason }, 'Failed to record a refused request');
  }
}

// ----- Guards -----

const guardPermissions = new WeakMap<object, readonly Permission[]>();

/** The permissions a guard from this file checks, or undefined for any other handler. The route walks read it. */
export function permissionsOfGuard(handler: unknown): readonly Permission[] | undefined {
  return typeof handler === 'function' ? guardPermissions.get(handler) : undefined;
}

type Guard = (req: Request, res: Response, next: NextFunction) => void;

function guard(permissions: readonly Permission[], passes: (held: readonly string[]) => boolean): Guard {
  const check: Guard = (req, res, next) => {
    if (!req.user) {
      deny(req, res, DENY_REASON.NO_CREDENTIALS);
      return;
    }
    if (!passes(req.user.permissions)) {
      deny(req, res, DENY_REASON.NO_PERMISSION);
      return;
    }
    next();
  };
  guardPermissions.set(check, permissions);
  return check;
}

/**
 * Require user to have at least one of the specified permissions.
 * Typed by the core-models list, so an unknown permission is a compile error.
 */
export function requirePermission(...permissions: readonly Permission[]): Guard {
  return guard(permissions, (held) => permissions.some((p) => held.includes(p)));
}

/**
 * Require user to have all of the specified permissions.
 */
export function requireAllPermissions(...permissions: readonly Permission[]): Guard {
  return guard(permissions, (held) => permissions.every((p) => held.includes(p)));
}
