// ===========================================
// Rate Limiting Middleware
// ===========================================
// Protects against brute force attacks.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// ===========================================
// Auth Rate Limiter
// ===========================================
// Strict limit for failed login attempts. Successful logins do not count:
// behind a NAT or reverse proxy every user shares one bucket, and counting
// them locked a whole site out after five ordinary sign-ins.

const isProduction = process.env.NODE_ENV === 'production';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 1000, // strict in production, relaxed in dev/test (E2E runs ~60 logins)
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again in 15 minutes.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ===========================================
// Refresh Rate Limiter
// ===========================================
// Every open tab refreshes at least once per access-token lifetime, so the
// login limit (5 per 15 min per IP) logged users out once a handful shared an
// IP. A refresh needs a valid httpOnly refresh token, which cannot be guessed,
// so this limit only has to stop a runaway client.

export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 300 : 1000,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many token refreshes. Please slow down.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ===========================================
// Script Test Run Rate Limiter
// ===========================================
// A test run starts a worker and runs user code for up to 5 seconds, and runs
// one at a time per server, so a burst of Run clicks should slow down rather
// than queue. Counted per signed-in user (IP when there is none).

export const testRunRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 30 : 1000,
  keyGenerator: (req) => (req as { user?: { id?: string } }).user?.id ?? ipKeyGenerator(req.ip ?? ''),
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many test runs. Wait a minute and try again.' },
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

// ===========================================
// API Key Rate Limiter
// ===========================================
// A second limit, counted per API key (D-313), so one leaked or runaway key
// slows down without the people behind the same address sharing its bucket.
// Requests signed in as a person skip it. API_KEY_RATE_LIMIT_MAX overrides.
const apiKeyRateLimitMax = ((): number => {
  const configured = Number(process.env['API_KEY_RATE_LIMIT_MAX']);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return isProduction ? 300 : 1000;
})();

export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: apiKeyRateLimitMax,
  skip: (req) => (req as { apiKeyId?: string }).apiKeyId === undefined,
  keyGenerator: (req) => `api-key:${(req as { apiKeyId?: string }).apiKeyId ?? ''}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests with this API key. Please slow down.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

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
