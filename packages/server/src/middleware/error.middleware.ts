// ===========================================
// Error Handling Middleware
// ===========================================
// Global error handler for Express.

import type { NextFunction, Request, Response } from 'express';
import { errorInfo } from '@galvaniflow/core-util';
import logger from '../lib/logger.js';
import { config } from '../config/index.js';

/** What the caller is told about a body the parser refused. Never the parser's own text: it quotes the body. */
const CLIENT_ERRORS: Readonly<Record<number, { readonly code: string; readonly message: string }>> = {
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'The request body encoding is not supported' },
};
const BAD_REQUEST = { code: 'BAD_REQUEST', message: 'The request body could not be read' } as const;

/**
 * The 4xx status of an error that is the caller's fault, such as a body the
 * JSON parser refused. These are http-errors with `expose` set; anything else
 * is a server fault.
 */
function clientError(err: unknown): { readonly status: number; readonly type: string | undefined } | undefined {
  // A thrown value's getters or Proxy traps may throw (#238): such a value is a server fault.
  try {
    if (!(err instanceof Error)) return undefined;
    const { status, expose, type } = err as Error & { status?: unknown; expose?: unknown; type?: unknown };
    if (typeof status !== 'number' || status < 400 || status > 499 || expose !== true) return undefined;
    // body-parser's `type` (entity.too.large, entity.parse.failed) names the cause without quoting the body.
    return { status, type: typeof type === 'string' ? type : undefined };
  } catch {
    return undefined;
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const refused = clientError(err);
  if (refused !== undefined) {
    logger.warn({ status: refused.status, type: refused.type, path: req.path, method: req.method }, 'Request body refused');
    res.status(refused.status).json({ success: false, error: CLIENT_ERRORS[refused.status] ?? BAD_REQUEST });
    return;
  }

  const info = errorInfo(err);

  logger.error({ ...info, path: req.path, method: req.method }, 'Unhandled error');

  // Don't leak error details in production
  const message = config.NODE_ENV === 'production' ? 'Internal server error' : info['errMsg'];

  res.status(500).json({ success: false, error: { code: 'INTERNAL', message } });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}
