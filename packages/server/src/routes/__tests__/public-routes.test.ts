// The guard in front of every router (#217, D-299, #157). Nothing reaches a
// handler, so no database is needed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { walkApiRoutes, isPublic, PUBLIC_ROUTES, type ApiRoute } from './api-routes.js';

const ID = '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c';

const concrete = (path: string): string => path.replace(/:\w+/g, ID);

/** The parts of an Express 5 router layer these checks read. */
interface StackLayer {
  readonly handle: unknown;
  readonly route?: { readonly path: unknown };
  match(path: string): boolean;
}

let server: Server;
let base: string;
let routes: readonly ApiRoute[];
let appLayers: readonly StackLayer[];
let indexLayers: readonly StackLayer[];
let real: { readonly authenticate: unknown; readonly authRoutes: unknown; readonly apiRateLimiter: unknown; readonly index: unknown };

beforeAll(async () => {
  // Hundreds of requests from one address: lift the API limiter for this file only.
  process.env['API_RATE_LIMIT_MAX'] = '100000';
  const app = (await import('../../app.js')).default;
  const index = (await import('../index.js')).default;
  routes = (await walkApiRoutes(index)).map(({ method, path }) => ({ method, path }));
  appLayers = (app as unknown as { router: { stack: readonly StackLayer[] } }).router.stack;
  indexLayers = index.stack as unknown as readonly StackLayer[];
  real = {
    authenticate: (await import('../../middleware/auth.middleware.js')).authenticate,
    authRoutes: (await import('../auth.routes.js')).default,
    apiRateLimiter: (await import('../../middleware/rate-limit.middleware.js')).apiRateLimiter,
    index,
  };
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 60_000); // Loads the whole app and every router; under a full parallel run that outlasts the 10 s hook default.

afterAll(async () => {
  const running = server as Server | undefined;
  if (running) await new Promise<void>((resolve) => { running.close(() => { resolve(); }); });
});

interface Answer {
  readonly status: number;
  readonly message: string | undefined;
}

async function call(route: ApiRoute, headers: Readonly<Record<string, string>> = {}, body?: string): Promise<Answer> {
  const res = await fetch(`${base}${concrete(route.path)}`, {
    method: route.method,
    headers: { connection: 'close', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { status: res.status, message: json.error?.message };
}

const takesBody = (r: ApiRoute): boolean => r.method !== 'GET' && r.method !== 'HEAD';

const ANSWER_WAIT_MS = 15_000;

/**
 * POST a chunked body that never ends and read the answer's status line. A body
 * parser in front of the guard would wait for the end forever.
 *
 * Only 8 KB, which the server reads off the socket unasked: streaming more left
 * unread bytes, and the reset on close could beat the 401 to the client (#254).
 * A reset after the status line is still taken as the answer.
 */
function postUnfinishedBody(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(base);
    const socket = connect(Number(port), hostname);
    let received = '';
    let settled = false;
    const finish = (outcome: number | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (typeof outcome === 'number') resolve(outcome); else reject(outcome);
    };
    const timer = setTimeout(() => { finish(new Error(`no answer within ${String(ANSWER_WAIT_MS)} ms: something waited for the body's end`)); }, ANSWER_WAIT_MS);
    const statusLine = (): RegExpExecArray | null => /^HTTP\/1\.1 (\d{3}) /.exec(received);
    socket.setEncoding('latin1');
    socket.on('data', (data: string) => {
      received += data;
      const match = statusLine();
      if (match) finish(Number(match[1]));
    });
    socket.on('error', (err) => { finish(err); });
    socket.on('close', () => { finish(new Error(`connection closed before a status line; got ${JSON.stringify(received)}`)); });
    const prefix = ' '.repeat(8 * 1024);
    socket.write(
      `POST ${path} HTTP/1.1\r\nhost: ${hostname}\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n`
      + `${prefix.length.toString(16)}\r\n${prefix}\r\n`,
    );
  });
}

describe('the route walk', () => {
  it('finds the routers index.ts mounts', () => {
    // A floor, not a count: it only shows the walk is not reading an empty stack.
    expect(routes.length).toBeGreaterThan(100);
    expect(routes).toContainEqual({ method: 'GET', path: '/api/v1/channels/:id' });
    expect(routes).toContainEqual({ method: 'POST', path: '/api/v1/auth/logout' });
  });

  it('finds every listed public route, so the list cannot outlive its routes', () => {
    for (const p of PUBLIC_ROUTES) expect(routes).toContainEqual({ method: p.method, path: p.path });
  });
});

describe('where the guard sits', () => {
  it('has only the /health route and the auth router above it in routes/index.ts', () => {
    const guard = indexLayers.findIndex((layer) => layer.handle === real.authenticate);
    expect(guard).toBeGreaterThan(0);
    const above = indexLayers.slice(0, guard);
    expect(above).toHaveLength(2);
    expect(above[0]?.route?.path).toBe('/health');
    expect(above[1]?.handle).toBe(real.authRoutes);
  });

  it('is the only thing app.ts mounts under /api/v1 besides the API rate limiter', () => {
    // Layers that match /api/v1 but not another path are the ones mounted there.
    const onlyApi = appLayers.filter((layer) => layer.match('/api/v1/anything') && !layer.match('/elsewhere'));
    expect(onlyApi.map((layer) => layer.handle)).toEqual([real.apiRateLimiter, real.index]);
  });
});

describe('a caller without a session', () => {
  it('is refused by the guard on every route that is not public', async () => {
    const reached: string[] = [];
    for (const route of routes.filter((r) => !isPublic(r))) {
      const anonymous = await call(route);
      // The messages are load-bearing: only authenticate answers 'Unauthorized' (no header) and
      // 'Invalid or expired token' (bad token), so a 401 from a handler cannot pass for the guard.
      const bogus = await call(route, { authorization: 'Bearer not-a-token' });
      if (anonymous.status !== 401 || anonymous.message !== 'Unauthorized') reached.push(`${route.method} ${route.path} anonymous: ${String(anonymous.status)}`);
      if (bogus.status !== 401 || bogus.message !== 'Invalid or expired token') reached.push(`${route.method} ${route.path} bogus token: ${String(bogus.status)}`);
      // A parser in front of the guard would answer 400 here (#157).
      const malformed = takesBody(route) ? await call(route, {}, '{not json') : anonymous;
      if (malformed.status !== 401 || malformed.message !== 'Unauthorized') reached.push(`${route.method} ${route.path} malformed body: ${String(malformed.status)}`);
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

describe('request bodies are read only after the guard (#157)', () => {
  const channels: ApiRoute = { method: 'POST', path: '/api/v1/channels' };
  const login: ApiRoute = { method: 'POST', path: '/api/v1/auth/login' };

  it('answers malformed JSON from a caller without a session with 401, not a parse error', async () => {
    expect(await call(channels, {}, '{not json')).toEqual({ status: 401, message: 'Unauthorized' });
  });

  it('answers a caller without a session before reading the body', async () => {
    expect(await postUnfinishedBody(channels.path)).toBe(401);
  }, ANSWER_WAIT_MS + 5_000);

  it('refuses a login body over its small limit with 413', async () => {
    expect((await call(login, {}, JSON.stringify({ pad: 'x'.repeat(8 * 1024) }))).status).toBe(413);
  });

  it('still parses a small login body', async () => {
    const answer = await call(login, {}, JSON.stringify({ username: 'kpatel' }));
    // The validator saw the parsed username and missed only the password.
    expect(answer.status).toBe(400);
    expect(answer.message).toContain('at password');
    expect(answer.message).not.toContain('username');
  });
});
