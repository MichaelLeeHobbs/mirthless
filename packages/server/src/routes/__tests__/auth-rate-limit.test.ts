// ===========================================
// Auth Rate Limit Tests
// ===========================================
// Verifies that authentication endpoints have rate limiting applied.

import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before importing routes
vi.mock('../../controllers/auth.controller.js', () => ({
  AuthController: {
    login: vi.fn((_req, res) => { res.json({ ok: true }); }),
    refresh: vi.fn((_req, res) => { res.json({ ok: true }); }),
    logout: vi.fn((_req, res) => { res.json({ ok: true }); }),
  },
}));

vi.mock('../../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req, _res, next) => { next(); }),
}));

vi.mock('../../middleware/validate.middleware.js', () => ({
  validate: () => vi.fn((_req, _res, next) => { next(); }),
}));

const { authRateLimiter } = await import('../../middleware/rate-limit.middleware.js');
const router = (await import('../auth.routes.js')).default;

// ----- Helpers -----

interface RouteLayer {
  readonly route?: {
    readonly path: string;
    readonly methods: Readonly<Record<string, boolean>>;
    readonly stack: readonly MiddlewareLayer[];
  };
}

interface MiddlewareLayer {
  readonly handle: (...args: readonly unknown[]) => unknown;
  readonly name: string;
}

/** Get the middleware stack for a specific route + method. */
function getRouteMiddleware(path: string, method: string): readonly MiddlewareLayer[] {
  const layers = router.stack as readonly RouteLayer[];
  for (const layer of layers) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack;
    }
  }
  return [];
}

// ----- Tests -----

describe('Auth Rate Limiting', () => {
  it('applies authRateLimiter to POST /login', () => {
    const stack = getRouteMiddleware('/login', 'post');
    const hasLimiter = stack.some((mw) => mw.handle === authRateLimiter);
    expect(hasLimiter).toBe(true);
  });

  it('applies authRateLimiter to POST /refresh', () => {
    const stack = getRouteMiddleware('/refresh', 'post');
    const hasLimiter = stack.some((mw) => mw.handle === authRateLimiter);
    expect(hasLimiter).toBe(true);
  });

  it('does not apply authRateLimiter to POST /logout', () => {
    const stack = getRouteMiddleware('/logout', 'post');
    const hasLimiter = stack.some((mw) => mw.handle === authRateLimiter);
    expect(hasLimiter).toBe(false);
  });
});
