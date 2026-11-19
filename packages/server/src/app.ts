import { createRequire } from 'module';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { config } from './config/index.js';
import logger from './lib/logger.js';
import routes from './routes/index.js';
import apiDocsRoutes from './routes/api-docs.routes.js';
import { requestId } from './middleware/request-id.middleware.js';
import { requestLogger } from './middleware/request-log.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { apiRateLimiter } from './middleware/rate-limit.middleware.js';
import { authenticate } from './middleware/auth.middleware.js';
import { requirePermission } from './middleware/permission.middleware.js';
import { getHealthStatus, getReadiness, healthHttpStatus } from './services/health.service.js';
import { registry } from './lib/metrics.js';
import { metricsMiddleware } from './middleware/metrics.middleware.js';

// Use createRequire for proper ESM/CJS interop with CJS packages
const require = createRequire(import.meta.url);
const compression = require('compression') as typeof import('compression');

const app: Express = express();

// Needed for rate limiting behind a reverse proxy.
app.set('trust proxy', config.TRUST_PROXY);

app.use(helmet());
app.use(
  cors({
    origin: config.FRONTEND_URL,
    credentials: true,
  })
);

app.use(compression({ threshold: 1024 }));

// For the httpOnly refresh token cookie.
app.use(cookieParser());

// Request bodies are parsed in routes/index.ts, after the rate limiter and the
// guard, never here (#157). No route takes a form-encoded body.

// Before logging, so requestId appears in logs.
app.use(requestId);

app.use(requestLogger(logger, config.LOG_HTTP_HEADERS));

app.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (_req: Request, res: Response) => {
  const readiness = await getReadiness();
  res.status(readiness.httpStatus).json(readiness.body);
});

app.get('/health', async (_req: Request, res: Response) => {
  // Unauthenticated: the status only, never memory or engine deployment counts.
  const health = await getHealthStatus();
  res.status(healthHttpStatus(health)).json({ status: health.status });
});

app.get('/health/full', authenticate, requirePermission('system:info'), async (_req: Request, res: Response) => {
  const health = await getHealthStatus();
  res.status(healthHttpStatus(health)).json(health);
});

const metricsHandler = async (_req: Request, res: Response): Promise<void> => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
};

if (config.METRICS_PUBLIC) {
  app.get('/metrics', metricsHandler);
} else {
  app.get('/metrics', authenticate, requirePermission('system:info'), metricsHandler);
}

// After the /metrics route, so it does not record itself.
app.use(metricsMiddleware);

const apiDocsEnabled = config.API_DOCS_ENABLED ?? config.NODE_ENV !== 'production';
if (apiDocsEnabled) {
  app.use('/api-docs', apiDocsRoutes);
}

app.use('/api/v1', apiRateLimiter);

app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
