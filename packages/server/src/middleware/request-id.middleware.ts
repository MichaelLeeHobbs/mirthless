// ===========================================
// Request ID Middleware
// ===========================================
// Assigns a unique request ID to each request for log correlation.
// Reads X-Request-ID from incoming headers (load balancer/client),
// or generates a UUID v4 if not present.

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}
