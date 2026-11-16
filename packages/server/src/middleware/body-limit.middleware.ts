// ===========================================
// Body Limit Middleware
// ===========================================
// No request body is read before the caller is known (#157). routes/index.ts
// mounts jsonBody after the API's one `authenticate`, the few routes that take
// a whole backup, a channel export or a message parse theirs with
// largeJsonBody inside their routers, and login parses its small body with
// authJsonBody after the login rate limiter.

import express, { type RequestHandler } from 'express';

const DEFAULT_LIMIT = '1mb';
/** Backups, channel imports and messages with embedded documents. docker/nginx/default.conf caps bodies just above this. */
const LARGE_LIMIT = '50mb';
/** A username and a password. */
const AUTH_LIMIT = '4kb';

const LARGE_BODY_ROUTES: ReadonlyArray<RegExp> = [
  /^\/api\/v1\/system\/backup\/?$/,
  /^\/api\/v1\/channels\/import(\/mirth(\/preview)?)?\/?$/,
  /^\/api\/v1\/channels\/[^/]+\/send-message\/?$/,
];

const defaultJson = express.json({ limit: DEFAULT_LIMIT });
const largeJson = express.json({ limit: LARGE_LIMIT });

/** True for the routes that accept a large JSON body. */
export function isLargeBodyRoute(path: string): boolean {
  return LARGE_BODY_ROUTES.some((route) => route.test(path));
}

/**
 * Parse a JSON body up to the default limit. Mount after `authenticate`. The
 * large-body routes are left unparsed here: their body is read by
 * {@link largeJsonBody}.
 */
export const jsonBody: RequestHandler = (req, res, next) => {
  if (isLargeBodyRoute(req.baseUrl + req.path)) { next(); return; }
  defaultJson(req, res, next);
};

/** Parse the body of a large-body route. Mount after `authenticate`. */
export const largeJsonBody: RequestHandler = (req, res, next) => {
  if (!isLargeBodyRoute(req.baseUrl + req.path)) { next(); return; }
  largeJson(req, res, next);
};

/** Parse a sign-in body, which has no session to check first. Mount after the login rate limiter. */
export const authJsonBody: RequestHandler = express.json({ limit: AUTH_LIMIT });
