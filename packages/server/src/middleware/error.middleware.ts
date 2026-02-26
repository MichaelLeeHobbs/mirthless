// ===========================================
// Error Handling Middleware
// ===========================================
// Global error handler for Express.

import type { NextFunction, Request, Response } from 'express';
import { stderr } from 'stderr-lib';
import logger from '../lib/logger.js';
import { config } from '../config/index.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const error = stderr(err);

  logger.error({ error, path: req.path, method: req.method }, 'Unhandled error');

  // Don't leak error details in production
  const message = config.NODE_ENV === 'production' ? 'Internal server error' : error.message;

  res.status(500).json({ success: false, error: message });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
}
