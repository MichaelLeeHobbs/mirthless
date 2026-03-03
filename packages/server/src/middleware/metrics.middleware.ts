// ===========================================
// Metrics Middleware
// ===========================================
// Records HTTP request duration and count for Prometheus.
// Normalizes paths to prevent label cardinality explosion.

import type { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, httpRequestTotal } from '../lib/metrics.js';

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const SKIP_PATHS = new Set(['/health', '/health/live', '/health/ready', '/metrics']);

/** Normalize path by replacing UUIDs with :id to prevent cardinality explosion */
export function normalizePath(path: string): string {
  return path.replace(UUID_REGEX, ':id');
}

/** Express middleware that records HTTP request duration and count */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;
  if (SKIP_PATHS.has(path)) {
    next();
    return;
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const route = normalizePath(
      req.route?.path ? `${req.baseUrl}${req.route.path as string}` : req.path,
    );
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequestDuration.observe(labels, durationSec);
    httpRequestTotal.inc(labels);
  });

  next();
}
