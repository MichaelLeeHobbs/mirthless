// ===========================================
// Express Application
// ===========================================
// Configures middleware chain and mounts routes.

import { createRequire } from 'module';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { config } from './config/index.js';
import logger from './lib/logger.js';
import routes from './routes/index.js';
import { requestId } from './middleware/request-id.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { apiRateLimiter } from './middleware/rate-limit.middleware.js';
import { checkDatabase, getHealthStatus } from './services/health.service.js';
import { registry } from './lib/metrics.js';
import { metricsMiddleware } from './middleware/metrics.middleware.js';

// Use createRequire for proper ESM/CJS interop with CJS packages
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http') as typeof import('pino-http').default;
const compression = require('compression') as typeof import('compression');

const app: Express = express();

// Trust proxy (needed for rate limiting behind reverse proxy)
app.set('trust proxy', config.TRUST_PROXY);

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: config.FRONTEND_URL,
    credentials: true,
  })
);

// Compression
app.use(compression({ threshold: 1024 }));

// Cookie parsing (for httpOnly refresh token cookies)
app.use(cookieParser());

// Request parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request ID tracking (before logging so requestId appears in logs)
app.use(requestId);

// Request logging
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ requestId: (req as Request).id }),
    autoLogging: {
      ignore: (req) => {
        const url = (req as Request).url;
        return url === '/health' || url === '/health/live' || url === '/health/ready' || url === '/metrics';
      },
    },
  })
);

// Health check endpoints (liveness, readiness, full)
app.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (_req: Request, res: Response) => {
  const dbOk = await checkDatabase();
  const status = dbOk ? 200 : 503;
  res.status(status).json({ status: dbOk ? 'ok' : 'unavailable', database: { connected: dbOk } });
});

app.get('/health', async (_req: Request, res: Response) => {
  const health = await getHealthStatus();
  const status = health.status === 'ok' ? 200 : 503;
  res.status(status).json(health);
});

// Prometheus metrics endpoint (no auth required)
app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

// Metrics collection middleware (after /metrics route to skip self-recording)
app.use(metricsMiddleware);

// Global API rate limiter (100 req/min per IP)
app.use('/api/v1', apiRateLimiter);

// API routes
app.use('/api/v1', routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
