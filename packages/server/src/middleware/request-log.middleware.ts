// ===========================================
// Request Log Middleware
// ===========================================
// pino-http request logging. Health and metrics probes are not logged.

import { createRequire } from 'module';
import type { Request, RequestHandler } from 'express';
import type { Logger } from 'pino';

// Use createRequire for proper ESM/CJS interop with the CJS package
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http') as typeof import('pino-http').default;

const UNLOGGED_PATHS: ReadonlySet<string> = new Set(['/health', '/health/live', '/health/ready', '/metrics']);

/**
 * The request logging middleware. With `includeHeaders` false the request is
 * logged as `id`, `method` and `url` and the response as `statusCode`; true
 * keeps pino-http's full serializers, headers included.
 */
export function requestLogger(logger: Logger, includeHeaders: boolean): RequestHandler {
  return pinoHttp({
    logger,
    customProps: (req) => ({ requestId: (req as Request).id }),
    autoLogging: { ignore: (req) => UNLOGGED_PATHS.has((req as Request).url) },
    ...(includeHeaders
      ? {}
      : {
          serializers: {
            req: (req: Record<string, unknown>) => ({
              id: req['id'],
              method: req['method'],
              url: req['url'],
            }),
            res: (res: Record<string, unknown>) => ({
              statusCode: res['statusCode'],
            }),
          },
        }),
  });
}
