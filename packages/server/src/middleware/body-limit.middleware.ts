// ===========================================
// Body Limit Middleware
// ===========================================
// JSON bodies are capped at 1 MB, except on the few routes that take a whole
// backup, a channel export or a message. Those routes are parsed only after
// authentication (see largeJsonBody).

import express, { type RequestHandler } from 'express';

const DEFAULT_LIMIT = '1mb';
/** Backups, channel imports and messages with embedded documents. */
const LARGE_LIMIT = '50mb';

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
 * Parse a JSON body up to the default limit. The large-body routes are left
 * unparsed here: their body is read by {@link largeJsonBody}, which their
 * routers mount after authentication, so nobody without a session (and nothing
 * the rate limiter has refused) can make the server parse 50 MB of JSON.
 */
export const jsonBody: RequestHandler = (req, res, next) => {
  if (isLargeBodyRoute(req.path)) { next(); return; }
  defaultJson(req, res, next);
};

/** Parse the body of a large-body route. Mount after `authenticate`. */
export const largeJsonBody: RequestHandler = (req, res, next) => {
  if (!isLargeBodyRoute(req.baseUrl + req.path)) { next(); return; }
  largeJson(req, res, next);
};
