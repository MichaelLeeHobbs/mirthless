// ===========================================
// Walk the routes the API mounts
// ===========================================
// Shared by public-routes.test.ts, role-access.test.ts and route-walk.itest.ts.
// It reads routes/index.ts for its imports and mounts, so a router mounted there
// is walked without being listed anywhere else.

import { readFileSync } from 'node:fs';
import type { Router } from 'express';

export interface ApiRoute {
  readonly method: string;
  /** The path template under /api/v1, such as `/api/v1/channels/:id`. */
  readonly path: string;
}

export interface WalkedRoute extends ApiRoute {
  /** The route's own handlers in order: guard, validator, controller. Router-wide middleware is not included. */
  readonly handlers: readonly unknown[];
}

interface RouteLayer {
  readonly route?: {
    readonly path: string | readonly string[];
    readonly methods: Readonly<Record<string, boolean>>;
    readonly stack: ReadonlyArray<{ readonly handle: unknown }>;
  };
}

/** The routes a router defines itself, under `prefix`. */
function routesOf(router: Router, prefix: string): readonly WalkedRoute[] {
  return (router.stack as unknown as readonly RouteLayer[]).flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    const paths = typeof route.path === 'string' ? [route.path] : route.path;
    const handlers = route.stack.map((l) => l.handle);
    return paths.flatMap((p) => Object.keys(route.methods).map((m) => ({
      method: m.toUpperCase(), path: `${prefix}${p === '/' ? '' : p}`, handlers,
    })));
  });
}

/** Every route under /api/v1: index.ts's own, then each mounted router's, in mount order. */
export async function walkApiRoutes(index: Router): Promise<readonly WalkedRoute[]> {
  const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const files = new Map([...source.matchAll(/import (\w+) from '\.\/([\w-]+\.routes)\.js'/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
  const mounts = [...source.matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)].map((m) => [m[1] ?? '', m[2] ?? ''] as const);
  const walked: WalkedRoute[] = [...routesOf(index, '/api/v1')];
  for (const [mount, name] of mounts) {
    const file = files.get(name);
    if (!file) throw new Error(`index.ts mounts ${name}, which it does not import from a routes file`);
    // Vite resolves a variable import only against source files, so name the .ts.
    const router = ((await import(`../${file}.ts`)) as { default: Router }).default;
    walked.push(...routesOf(router, `/api/v1${mount}`));
  }
  return walked;
}

/** The only /api/v1 routes a caller without a session reaches (D-299). Each needs a reason. */
export const PUBLIC_ROUTES: ReadonlyArray<ApiRoute & { readonly reason: string }> = [
  { method: 'GET', path: '/api/v1/health', reason: 'Liveness for load balancers and Playwright; answers only "ok".' },
  { method: 'POST', path: '/api/v1/auth/login', reason: 'The caller has no session yet. Behind the login rate limiter.' },
  { method: 'POST', path: '/api/v1/auth/refresh', reason: 'Proves itself with the httpOnly refresh cookie. Behind its own rate limiter.' },
];

/**
 * Routes any signed-in user reaches, with no permission guard: they act only on
 * the caller's own session, password or preferences. role-access.test.ts fails on
 * any other route without a guard; docs/user/access-control.md lists these.
 */
export const SESSION_ONLY_ROUTES: ReadonlyArray<ApiRoute & { readonly reason: string }> = [
  { method: 'POST', path: '/api/v1/auth/logout', reason: 'Ends the caller\'s own session. Authenticates itself, above the API guard.' },
  { method: 'POST', path: '/api/v1/users/me/password', reason: 'Changes the caller\'s own password; also the one route open while a change is required.' },
  { method: 'GET', path: '/api/v1/users/me/preferences', reason: 'The caller\'s own preferences.' },
  { method: 'PUT', path: '/api/v1/users/me/preferences', reason: 'The caller\'s own preferences.' },
  { method: 'PUT', path: '/api/v1/users/me/preferences/bulk', reason: 'The caller\'s own preferences.' },
  { method: 'GET', path: '/api/v1/users/me/preferences/:key', reason: 'The caller\'s own preferences.' },
  { method: 'DELETE', path: '/api/v1/users/me/preferences/:key', reason: 'The caller\'s own preferences.' },
];

export const isPublic =(r: ApiRoute): boolean => PUBLIC_ROUTES.some((p) => p.method === r.method && p.path === r.path);
