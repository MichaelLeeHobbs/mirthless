// ===========================================
// Permission Middleware
// ===========================================
// The route guards, and deny(): the one way a guard refuses a request. deny()
// answers through errorResponse and records the refusal as an ACCESS_DENIED
// event, once a minute per caller, route and reason (#158).

import type { NextFunction, Request, Response, Router } from 'express';
import { ALL_CHANNELS, AUDIT_ACTION, can, holdsPermission, type ChannelGroupId, type FoldedGrants, type Permission } from '@galvanigraph/core-models';
import { CHANNEL_ID, channelGroupIds } from '../lib/channel-scope.js';
import { errorInfo } from '@galvanigraph/core-util';
import { ServiceError, type ServiceErrorCode } from '../lib/service-error.js';
import { errorResponse, mapErrorToStatus } from '../lib/controller-helpers.js';
import { emitAuditEvent } from '../lib/event-emitter.js';
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
  /** The permission is held, but not on this channel's groups. Answered as not found (D-310). */
  OUT_OF_SCOPE: 'out_of_scope',
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
  // The same answer a channel that does not exist gets, so scope never shows
  // which channels exist outside it.
  out_of_scope: ['NOT_FOUND', 'Channel not found'],
};

// ----- Coalescing -----
// One record per caller, route and reason a minute. The keys are bounded by the
// users, the route templates and the reasons, never by the URL a caller sends:
// every anonymous refusal before routing shares one key per reason. A sweep
// each minute writes the refusals a closed window held back, so a burst that
// stops is still counted, and forgets the window.

const WINDOW_MS = 60_000;
const MAX_WINDOWS = 10_000;

/** What a refusal record says, apart from its request id and repeat count. */
interface Refusal {
  readonly userId: string | null;
  readonly ipAddress: string | null;
  readonly method: string;
  readonly route: string | null;
  readonly reason: DenyReason;
  readonly status: number;
}

interface Window {
  readonly start: number;
  readonly refusal: Refusal;
  repeats: number;
}

const windows = new Map<string, Window>();
let sweeper: ReturnType<typeof setInterval> | undefined;

function writeRefusal(refusal: Refusal, requestId: string | null, repeatsSinceLast: number): void {
  const { userId, ipAddress, ...rest } = refusal;
  emitAuditEvent({
    action: AUDIT_ACTION.ACCESS_DENIED, outcome: 'FAILURE', userId, ipAddress,
    attributes: { ...rest, principal: userId === null ? 'anonymous' : 'user', requestId, repeatsSinceLast },
  });
}

/** Write what each closed window held back (all of them with `all`), then forget it. */
function sweep(now: number, all = false): void {
  for (const [key, w] of windows) {
    if (!all && now - w.start < WINDOW_MS) continue;
    windows.delete(key);
    try {
      if (w.repeats > 0) writeRefusal(w.refusal, null, w.repeats);
    } catch (err: unknown) {
      logger.warn({ ...errorInfo(err), reason: w.refusal.reason }, 'Failed to record refused requests');
    }
  }
  if (windows.size === 0 && sweeper !== undefined) {
    clearInterval(sweeper);
    sweeper = undefined;
  }
}

/** True when `refusal` opens a window and should be written now; false while one is open. */
function openWindow(key: string, refusal: Refusal, now: number): boolean {
  const open = windows.get(key);
  if (open && now - open.start < WINDOW_MS) {
    open.repeats += 1;
    return false;
  }
  if (open) sweep(now);
  // Full: every key was refused within the minute. Write what is held and start over rather than grow.
  if (windows.size >= MAX_WINDOWS) sweep(now, true);
  windows.set(key, { start: now, refusal, repeats: 0 });
  sweeper ??= setInterval(() => { sweep(Date.now()); }, WINDOW_MS).unref();
  return true;
}

/**
 * The route template (`/api/v1/channels/:id`), or null before routing. Never
 * the URL. Express matches mount paths in any case and keeps the caller's, so
 * the mount path is lower-cased: every mount in routes/index.ts is lower case.
 */
function routeTemplate(req: Request): string | null {
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') return null;
  const base = req.baseUrl.toLowerCase();
  // A router's own '/' is the mount path itself: /api/v1/users, not /api/v1/users/.
  return path === '/' && base !== '' ? base : `${base}${path}`;
}

function recordRefusal(req: Request, reason: DenyReason, status: number, userId: string | undefined): void {
  const route = routeTemplate(req);
  const refusal: Refusal = { userId: userId ?? null, ipAddress: req.ip ?? null, method: req.method, route, reason, status };
  if (!openWindow(`${userId ?? '-'}|${req.method} ${route ?? '-'}|${reason}`, refusal, Date.now())) return;
  writeRefusal(refusal, req.id === undefined ? null : String(req.id), 0);
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

/**
 * Whether the scoped part of a check passes: when the route names a channel
 * (scopeToChannel read its groups into req.channelScope), the caller must hold
 * the permission on that channel, not merely somewhere.
 */
type OnChannel = (grants: FoldedGrants, groupIds: readonly ChannelGroupId[]) => boolean;

function guard(permissions: readonly Permission[], passes: (held: readonly string[]) => boolean, onChannel: OnChannel): Guard {
  const check: Guard = (req, res, next) => {
    if (!req.user) {
      deny(req, res, DENY_REASON.NO_CREDENTIALS);
      return;
    }
    if (!passes(req.user.permissions)) {
      deny(req, res, DENY_REASON.NO_PERMISSION);
      return;
    }
    const scope = req.channelScope;
    if (scope !== undefined && (!req.principal || !onChannel(req.principal.grants, scope))) {
      deny(req, res, DENY_REASON.OUT_OF_SCOPE);
      return;
    }
    next();
  };
  guardPermissions.set(check, permissions);
  return check;
}

/**
 * Require user to have at least one of the specified permissions; on a route
 * that names a channel, on that channel.
 * Typed by the core-models list, so an unknown permission is a compile error.
 */
export function requirePermission(...permissions: readonly Permission[]): Guard {
  return guard(
    permissions,
    (held) => permissions.some((p) => holdsPermission(held, p)),
    (grants, groupIds) => permissions.some((p) => can(grants, p, { groupIds })),
  );
}

/**
 * Require user to have all of the specified permissions; on a route that
 * names a channel, all of them on that channel.
 */
export function requireAllPermissions(...permissions: readonly Permission[]): Guard {
  return guard(
    permissions,
    (held) => permissions.every((p) => holdsPermission(held, p)),
    (grants, groupIds) => permissions.every((p) => can(grants, p, { groupIds })),
  );
}

/**
 * Scope every route of `router` that has `param` to the channel it names
 * (D-310, plan section 4). Before the route's guard runs, the channel's groups
 * are read from the database into req.channelScope, so requirePermission
 * checks the permission on that channel; a caller holding it only on other
 * groups gets the answer a missing channel gets. The channel comes from the
 * path, never the body. A caller whose every grant covers all channels needs no
 * lookup. A lookup that fails answers 500: no answer about the channel without
 * its groups.
 */
export function scopeToChannel(router: Router, param = 'id'): void {
  router.param(param, (req, _res, next, value: unknown) => {
    const grants = req.principal?.grants;
    if (grants !== undefined && [...grants.values()].every((s) => s === ALL_CHANNELS)) {
      next();
      return;
    }
    if (typeof value !== 'string' || !CHANNEL_ID.test(value)) {
      // Not a channel id: in no group, so out of scope unless held on every channel.
      req.channelScope = [];
      next();
      return;
    }
    channelGroupIds(value).then((groupIds) => {
      req.channelScope = groupIds;
      next();
    }, (err: unknown) => {
      logger.error({ ...errorInfo(err), channelId: value }, 'Could not read a channel\'s groups for a scope check');
      next(err);
    });
  });
}
