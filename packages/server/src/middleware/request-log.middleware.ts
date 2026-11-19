// Query parameter values are never logged: message searches carry their terms
// (usually MRNs or accession numbers) in the query string (#229).

import { createRequire } from 'module';
import type { Request, RequestHandler } from 'express';
import type { Logger } from 'pino';

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

/** Never logs pino-http's `query` field. `includeHeaders` comes from LOG_HTTP_HEADERS. */
export function requestLogger(logger: Logger, includeHeaders: boolean): RequestHandler {
  return pinoHttp({
    logger,
    customProps: (req) => ({ requestId: (req as Request).id }),
    autoLogging: { ignore: (req) => UNLOGGED_PATHS.has((req as Request).url) },
    serializers: {
      req: requestSerializer(includeHeaders),
      ...(includeHeaders ? {} : { res: (res: Serialized) => ({ statusCode: res['statusCode'] }) }),
    },
  });
}
