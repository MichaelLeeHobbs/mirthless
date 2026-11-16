// ===========================================
// Every /api/v1 route needs a session, except the listed public ones
// ===========================================
// routes/index.ts authenticates once, in front of every router (#217, D-298).
// This boots the real app, walks every route the routers define, and calls
// each one without credentials and with a bogus bearer token. Anything other
// than the guard's 401 fails, unless the route is in PUBLIC_ROUTES. A route
// mounted above the guard by mistake, or a router mounted before it, shows up
// here. Nothing reaches a handler, so no database is needed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Router } from 'express';

interface ApiRoute {
  readonly method: string;
  readonly path: string;
}

interface PublicRoute extends ApiRoute {
  readonly reason: string;
}

/** The only /api/v1 routes a caller without a session reaches. Each needs a reason. */
const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { method: 'GET', path: '/api/v1/health', reason: 'Liveness for load balancers and Playwright; answers only "ok".' },
  { method: 'POST', path: '/api/v1/auth/login', reason: 'The caller has no session yet. Behind the login rate limiter.' },
  { method: 'POST', path: '/api/v1/auth/refresh', reason: 'Proves itself with the httpOnly refresh cookie. Behind its own rate limiter.' },
];

const ID = '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c';

interface RouteLayer {
  readonly route?: { readonly path: string | readonly string[]; readonly methods: Readonly<Record<string, boolean>> };
}

/** The routes a router defines itself, under `prefix`. */
function routesOf(router: Router, prefix: string): readonly ApiRoute[] {
  return (router.stack as readonly RouteLayer[]).flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    const paths = typeof route.path === 'string' ? [route.path] : route.path;
    return paths.flatMap((p) => Object.keys(route.methods).map((m) => ({ method: m.toUpperCase(), path: `${prefix}${p === '/' ? '' : p}` })));
  });
}

/** Every route under /api/v1: index.ts's own, then each mounted router's, from index.ts's imports and mounts. */
async function walkApiRoutes(index: Router): Promise<readonly ApiRoute[]> {
  const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const files = new Map([...source.matchAll(/import (\w+) from '\.\/([\w-]+\.routes)\.js'/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
  const mounts = [...source.matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)].map((m) => [m[1] ?? '', m[2] ?? ''] as const);
  const walked: ApiRoute[] = [...routesOf(index, '/api/v1')];
  for (const [mount, name] of mounts) {
    const file = files.get(name);
    if (!file) throw new Error(`index.ts mounts ${name}, which it does not import from a routes file`);
    // Vite resolves a variable import only against source files, so name the .ts.
    const router = ((await import(`../${file}.ts`)) as { default: Router }).default;
    walked.push(...routesOf(router, `/api/v1${mount}`));
  }
  return walked;
}

const isPublic = (r: ApiRoute): boolean => PUBLIC_ROUTES.some((p) => p.method === r.method && p.path === r.path);
const concrete = (path: string): string => path.replace(/:\w+/g, ID);

let server: Server;
let base: string;
let routes: readonly ApiRoute[];

beforeAll(async () => {
  // Hundreds of requests from one address: lift the API limiter for this file only.
  process.env['API_RATE_LIMIT_MAX'] = '100000';
  const app = (await import('../../app.js')).default;
  routes = await walkApiRoutes((await import('../index.js')).default);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

interface Answer {
  readonly status: number;
  readonly message: string | undefined;
}

async function call(route: ApiRoute, headers: Readonly<Record<string, string>> = {}): Promise<Answer> {
  const res = await fetch(`${base}${concrete(route.path)}`, { method: route.method, headers: { connection: 'close', ...headers } });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { status: res.status, message: body.error?.message };
}

describe('the route walk', () => {
  it('finds the routers index.ts mounts', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(routes).toContainEqual({ method: 'GET', path: '/api/v1/channels/:id' });
    expect(routes).toContainEqual({ method: 'POST', path: '/api/v1/auth/logout' });
  });

  it('finds every listed public route, so the list cannot outlive its routes', () => {
    for (const p of PUBLIC_ROUTES) expect(routes).toContainEqual({ method: p.method, path: p.path });
  });
});

describe('a caller without a session', () => {
  it('is refused by the guard on every route that is not public', async () => {
    const reached: string[] = [];
    for (const route of routes.filter((r) => !isPublic(r))) {
      const anonymous = await call(route);
      const bogus = await call(route, { authorization: 'Bearer not-a-token' });
      if (anonymous.status !== 401 || anonymous.message !== 'Unauthorized') reached.push(`${route.method} ${route.path} anonymous: ${String(anonymous.status)}`);
      if (bogus.status !== 401 || bogus.message !== 'Invalid or expired token') reached.push(`${route.method} ${route.path} bogus token: ${String(bogus.status)}`);
    }
    expect(reached).toEqual([]);
  });

  it('is refused on a path under /api/v1 that no route defines', async () => {
    expect(await call({ method: 'GET', path: '/api/v1/no-such-thing' })).toEqual({ status: 401, message: 'Unauthorized' });
  });

  it('reaches the public routes past the guard', async () => {
    expect((await call({ method: 'GET', path: '/api/v1/health' })).status).toBe(200);
    // No body: the login validator answers, not the guard.
    expect((await call({ method: 'POST', path: '/api/v1/auth/login' })).status).toBe(400);
    expect(await call({ method: 'POST', path: '/api/v1/auth/refresh' })).toEqual({ status: 401, message: 'No refresh token provided' });
  });
});
