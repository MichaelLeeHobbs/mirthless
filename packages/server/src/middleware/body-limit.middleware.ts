// ===========================================
// Body Limit Middleware
// ===========================================
// JSON bodies are capped at 1 MB, except on the few routes that take a whole
// backup, a channel export or a message. The body is parsed before
// authentication, so the large limit is kept to those routes.

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

/** Parse a JSON body with the limit that fits the route. */
export const jsonBody: RequestHandler = (req, res, next) => {
  (isLargeBodyRoute(req.path) ? largeJson : defaultJson)(req, res, next);
};
