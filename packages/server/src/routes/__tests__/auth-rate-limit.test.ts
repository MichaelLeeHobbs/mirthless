import { describe, it, expect, vi } from 'vitest';

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

const { authRateLimiter, refreshRateLimiter } = await import('../../middleware/rate-limit.middleware.js');
const { authJsonBody } = await import('../../middleware/body-limit.middleware.js');
const router = (await import('../auth.routes.js')).default;

interface RouteLayer {
  readonly route?: {
    readonly path: string;
    readonly methods: Readonly<Record<string, boolean>>;
    readonly stack: readonly MiddlewareLayer[];
  };
}

interface MiddlewareLayer {
  readonly handle: unknown;
  readonly name: string;
}

function getRouteMiddleware(path: string, method: string): readonly MiddlewareLayer[] {
  const layers = router.stack as unknown as readonly RouteLayer[];
  for (const layer of layers) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack;
    }
  }
  return [];
}

describe('Auth Rate Limiting', () => {
  it('applies authRateLimiter to POST /login', () => {
    const stack = getRouteMiddleware('/login', 'post');
    const hasLimiter = stack.some((mw) => mw.handle === authRateLimiter);
    expect(hasLimiter).toBe(true);
  });

  it('reads the login body only after the login rate limiter (#157)', () => {
    const handles = getRouteMiddleware('/login', 'post').map((mw) => mw.handle);
    expect(handles.indexOf(authJsonBody)).toBeGreaterThan(handles.indexOf(authRateLimiter));
    expect(handles.indexOf(authRateLimiter)).toBe(0);
  });

  it('applies the separate refreshRateLimiter, not the login limiter, to POST /refresh', () => {
    const stack = getRouteMiddleware('/refresh', 'post');
    expect(stack.some((mw) => mw.handle === refreshRateLimiter)).toBe(true);
    expect(stack.some((mw) => mw.handle === authRateLimiter)).toBe(false);
  });

  it('does not apply authRateLimiter to POST /logout', () => {
    const stack = getRouteMiddleware('/logout', 'post');
    const hasLimiter = stack.some((mw) => mw.handle === authRateLimiter);
    expect(hasLimiter).toBe(false);
  });
});
