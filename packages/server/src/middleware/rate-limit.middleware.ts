import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Strict limit for failed login attempts. Successful logins do not count:
// behind a NAT or reverse proxy every user shares one bucket, and counting
// them locked a whole site out after five ordinary sign-ins.

const isProduction = process.env.NODE_ENV === 'production';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 5 : 1000, // E2E runs ~60 logins
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again in 15 minutes.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Every open tab refreshes at least once per access-token lifetime, so the
// login limit (5 per 15 min per IP) logged users out once a handful shared an
// IP. A refresh needs a valid httpOnly refresh token, which cannot be guessed,
// so this limit only has to stop a runaway client.

export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 300 : 1000,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many token refreshes. Please slow down.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// A test run starts a worker and runs user code for up to 5 seconds, one at a
// time per server, so a burst of Run clicks should slow down rather than queue.

export const testRunRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 30 : 1000,
  keyGenerator: (req) => (req as { user?: { id?: string } }).user?.id ?? ipKeyGenerator(req.ip ?? ''),
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many test runs. Wait a minute and try again.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Per client IP. Behind a NAT or reverse proxy every user shares one bucket and
// dashboards poll, so 100/min 429'd a normal ops team; 600/min still blunts abuse.
const apiRateLimitMax = ((): number => {
  const configured = Number(process.env['API_RATE_LIMIT_MAX']);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return isProduction ? 600 : 1000;
})();

// Per API key (D-313), so one leaked or runaway key slows down without the
// people behind the same address sharing its bucket.
const apiKeyRateLimitMax = ((): number => {
  const configured = Number(process.env['API_KEY_RATE_LIMIT_MAX']);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return isProduction ? 300 : 1000;
})();

export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
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
  windowMs: 60 * 1000,
  max: apiRateLimitMax,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
