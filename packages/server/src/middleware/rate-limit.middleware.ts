// ===========================================
// Rate Limiting Middleware
// ===========================================
// Protects against brute force attacks.

import rateLimit from 'express-rate-limit';

// ===========================================
// Auth Rate Limiter
// ===========================================
// Strict limit for login attempts

const isProduction = process.env.NODE_ENV === 'production';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 1000, // strict in production, relaxed in dev/test (E2E runs ~60 logins)
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again in 15 minutes.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ===========================================
// General API Rate Limiter
// ===========================================
// General protection for all API endpoints

// Applied to all of /api/v1 per client IP. The old 100/min production cap was too
// low: behind a NAT/reverse proxy every user shares one bucket, and dashboards poll,
// so a normal ops team 429'd during regular use. Default 600/min (10 req/s) still
// blunts abuse; override with API_RATE_LIMIT_MAX for larger/very-busy deployments.
const apiRateLimitMax = ((): number => {
  const configured = Number(process.env['API_RATE_LIMIT_MAX']);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return isProduction ? 600 : 1000;
})();

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: apiRateLimitMax,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
