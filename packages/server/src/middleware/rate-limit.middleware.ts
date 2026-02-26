// ===========================================
// Rate Limiting Middleware
// ===========================================
// Protects against brute force attacks.

import rateLimit from 'express-rate-limit';

// ===========================================
// Auth Rate Limiter
// ===========================================
// Strict limit for login attempts

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    error: 'Too many login attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ===========================================
// General API Rate Limiter
// ===========================================
// General protection for all API endpoints

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
