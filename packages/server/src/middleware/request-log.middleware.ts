// Query parameter values are never logged: message searches carry their terms
// (usually MRNs or accession numbers) in the query string (#229).

import { createRequire } from 'module';
import type { ServerResponse } from 'node:http';
import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { errorInfo, isPlainObject } from '@galvanigraph/core-util';
import { internalCause } from '../lib/controller-helpers.js';

// createRequire for ESM/CJS interop: pino-http is a CJS package.
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http') as typeof import('pino-http').default;

const UNLOGGED_PATHS: ReadonlySet<string> = new Set(['/health', '/health/live', '/health/ready', '/metrics']);

/** What the API's own parameter names look like. */
const LOGGABLE_NAME = /^[A-Za-z][\w.[\]-]{0,63}$/;
const HIDDEN_NAME = '<redacted>';

/** A part with no `=` may be the value itself (`?MRN123456`), so it is hidden. */
function loggedName(part: string): string {
  const eq = part.indexOf('=');
  if (eq === -1) { return HIDDEN_NAME; }
  let name: string;
  try {
    name = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '));
  } catch {
    return HIDDEN_NAME;
  }
  return LOGGABLE_NAME.test(name) ? encodeURIComponent(name) : HIDDEN_NAME;
}

/** Every value is dropped, so a new search parameter can't leak by being left off a list. */
export function urlWithoutQueryValues(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) { return url; }
  const parts = url.slice(q + 1).split('&').filter((part) => part.length > 0);
  const names = [...new Set(parts.map(loggedName))];
  return names.length > 0 ? `${url.slice(0, q)}?${names.join('&')}` : url.slice(0, q);
}

type Serialized = Record<string, unknown>;

function requestSerializer(includeHeaders: boolean): (req: Serialized) => Serialized {
  return (req) => {
    const url = typeof req['url'] === 'string' ? urlWithoutQueryValues(req['url']) : undefined;
    const base = { id: req['id'], method: req['method'], url };
    if (!includeHeaders) { return base; }
    return { ...base, headers: req['headers'], remoteAddress: req['remoteAddress'], remotePort: req['remotePort'] };
  };
}

const CAUSE = Symbol('internalCause');
const CLOSED_FIRST = Symbol('closedBeforeAnswer');
type NotedResponse = ServerResponse & { [CAUSE]?: { readonly cause: unknown }; [CLOSED_FIRST]?: true };

/**
 * Notes what a 500 answer was made from. Its request line is the one log line
 * every such answer leaves: many controllers answer without logging (#473).
 */
function noteInternalCause(req: Request, res: Response, logger: Logger): void {
  // Runs before pino-http's listener, which writes the line of a request whose
  // client left before the answer then, without the cause (a proxy's timeout).
  res.once('close', () => { if (!res.writableEnded) (res as NotedResponse)[CLOSED_FIRST] = true; });
  const json = res.json.bind(res);
  res.json = (body: unknown): Response => {
    const noted = isPlainObject(body) ? internalCause(body['error']) : undefined;
    if (noted !== undefined) {
      (res as NotedResponse)[CAUSE] = noted;
      if ((res as NotedResponse)[CLOSED_FIRST] === true) {
        logger.error({ requestId: req.id, method: req.method, url: urlWithoutQueryValues(req.originalUrl), err: errorInfo(noted.cause) }, 'Request failed after its client had gone');
      }
    }
    return json(body);
  };
}

/** Only `errorInfo`'s fields: the cause of a failed statement can quote a value (D-347). */
function withCause(res: ServerResponse, logged: object): object {
  const noted = (res as NotedResponse)[CAUSE];
  return noted === undefined ? logged : { ...logged, err: errorInfo(noted.cause) };
}

/** Never logs pino-http's `query` field. `includeHeaders` comes from LOG_HTTP_HEADERS. */
export function requestLogger(logger: Logger, includeHeaders: boolean): RequestHandler {
  const log = pinoHttp({
    logger,
    customProps: (req) => ({ requestId: (req as Request).id }),
    autoLogging: { ignore: (req) => UNLOGGED_PATHS.has((req as Request).url) },
    customLogLevel: (_req, res) => ((res as NotedResponse)[CAUSE] === undefined ? 'info' : 'error'),
    customSuccessObject: (_req, res, logged) => withCause(res, logged),
    customErrorObject: (_req, res, _err, logged) => withCause(res, logged),
    serializers: {
      req: requestSerializer(includeHeaders),
      ...(includeHeaders ? {} : { res: (res: Serialized) => ({ statusCode: res['statusCode'] }) }),
    },
  });
  return (req, res, next) => {
    noteInternalCause(req, res, logger);
    log(req, res, next);
  };
}
