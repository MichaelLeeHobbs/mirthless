// No request body is read before the caller is known (#157).

import express, { type RequestHandler } from 'express';

const DEFAULT_LIMIT = '1mb';
/** docker/nginx/default.conf caps bodies just above this. */
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

export function isLargeBodyRoute(path: string): boolean {
  return LARGE_BODY_ROUTES.some((route) => route.test(path));
}

/** Mount after `authenticate`. Leaves large-body routes to {@link largeJsonBody}. */
export const jsonBody: RequestHandler = (req, res, next) => {
  if (isLargeBodyRoute(req.baseUrl + req.path)) { next(); return; }
  defaultJson(req, res, next);
};

/** Mount after `authenticate`. */
export const largeJsonBody: RequestHandler = (req, res, next) => {
  if (!isLargeBodyRoute(req.baseUrl + req.path)) { next(); return; }
  largeJson(req, res, next);
};

/** Sign-in has no session to check first: mount after the login rate limiter. */
export const authJsonBody: RequestHandler = express.json({ limit: AUTH_LIMIT });
