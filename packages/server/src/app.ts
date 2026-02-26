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
      ignore: (req) => (req as Request).url === '/health',
    },
  })
);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Global API rate limiter (100 req/min per IP)
app.use('/api/v1', apiRateLimiter);

// API routes
app.use('/api/v1', routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
