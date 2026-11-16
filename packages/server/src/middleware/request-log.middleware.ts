// ===========================================
// Request Log Middleware
// ===========================================
// pino-http request logging. Health and metrics probes are not logged.
// Query parameter values are never logged: message searches carry their terms
// (usually MRNs or accession numbers) in the query string (#229).

import { createRequire } from 'module';
import type { Request, RequestHandler } from 'express';
import type { Logger } from 'pino';

// Use createRequire for proper ESM/CJS interop with the CJS package
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http') as typeof import('pino-http').default;

const UNLOGGED_PATHS: ReadonlySet<string> = new Set(['/health', '/health/live', '/health/ready', '/metrics']);

/**
 * A request URL reduced to its path and the names of its query parameters,
 * each once: `/messages?contentSearch=123&limit=25` becomes
 * `/messages?contentSearch&limit`. Every value is dropped, so a new search
 * parameter can't leak by being left off a list.
 */
export function urlWithoutQueryValues(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) { return url; }
  const names = [...new Set(new URLSearchParams(url.slice(q + 1)).keys())];
  return names.length > 0 ? `${url.slice(0, q)}?${names.join('&')}` : url.slice(0, q);
}

type Serialized = Record<string, unknown>;

/** pino-http's request serializer: id, method and the value-free URL, plus headers when asked. */
function requestSerializer(includeHeaders: boolean): (req: Serialized) => Serialized {
  return (req) => {
    const url = typeof req['url'] === 'string' ? urlWithoutQueryValues(req['url']) : undefined;
    const base = { id: req['id'], method: req['method'], url };
    if (!includeHeaders) { return base; }
    return { ...base, headers: req['headers'], remoteAddress: req['remoteAddress'], remotePort: req['remotePort'] };
  };
}

/**
 * The request logging middleware. The request is logged as `id`, `method` and
 * the URL without query values (never pino-http's `query` field); the response
 * as `statusCode`. `includeHeaders` (LOG_HTTP_HEADERS) adds the request headers,
 * the client address and pino-http's full response serializer.
 */
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
