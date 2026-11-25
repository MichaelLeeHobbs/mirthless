import { once } from 'node:events';
import { connect, type Socket } from 'node:net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.stubEnv('NODE_ENV', 'production');

const LIMIT = 5;
const MAX_WAITING = 50;
const TOO_MANY_FAILED = 'Too many login attempts. Please try again in 15 minutes.';
const TOO_MANY_AT_ONCE = 'Too many logins at once. Please try again in a few seconds.';
/** Far above what a wait takes, and below the 15 s a login waits for its place. */
const WAIT = { timeout: 10_000, interval: 10 };

/** A fresh limiter per test: they all sign in from one address. */
let server: Server;
let base = '';
let arrived = 0;
let handled = 0;
let sockets: Socket[] = [];
/** Answers wait for it, when a test sets it. */
let held: Promise<void> | null = null;

beforeEach(async () => {
  vi.resetModules();
  const { authRateLimiter, refreshRateLimiter } = await import('../rate-limit.middleware.js');
  arrived = 0;
  handled = 0;
  sockets = [];
  held = null;
  const app = express();
  app.set('trust proxy', 1);
  app.use((_req, _res, next) => { arrived += 1; next(); });
  const handler = async (req: express.Request, res: express.Response): Promise<void> => {
    handled += 1;
    await held;
    res.status(Number(req.query['status'] ?? 200)).json({});
  };
  app.post('/login', authRateLimiter, handler);
  app.post('/login-after-hang-up', async (req, _res, next) => { await once(req.socket, 'close'); next(); }, authRateLimiter, handler);
  app.post('/refresh', refreshRateLimiter, handler);
  server = app.listen(0, '127.0.0.1');
  server.on('connection', (socket) => { sockets.push(socket); });
  await once(server, 'listening');
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

interface Answer {
  readonly status: number;
  readonly message: string | undefined;
  readonly retryAfter: string | null;
}

async function login(status: number, headers: Record<string, string> = {}): Promise<Answer> {
  const res = await fetch(`${base}/login?status=${String(status)}`, { method: 'POST', headers });
  const body = await res.json() as { error?: { message?: string } };
  return { status: res.status, message: body.error?.message, retryAfter: res.headers.get('retry-after') };
}

async function inTurn(status: number, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await login(status)).status);
  return statuses;
}

const atOnce = (status: number, times: number): Promise<Answer[]> => Promise.all(Array.from({ length: times }, () => login(status)));
const statusesOf = (answers: readonly Answer[]): number[] => answers.map((a) => a.status);
const times = (n: number, status: number): number[] => Array.from({ length: n }, () => status);

function hold(): () => void {
  let release = (): void => undefined;
  held = new Promise((resolve) => { release = resolve; });
  return release;
}

const reached = (count: () => number, n: number): Promise<void> => vi.waitFor(() => { expect(count()).toBe(n); }, WAIT);
const arrivals = (n: number): Promise<void> => reached(() => arrived, n);
const handlerCalls = (n: number): Promise<void> => reached(() => handled, n);
const openSockets = (n: number): Promise<void> => reached(() => sockets.filter((s) => !s.destroyed).length, n);

const REQUEST = (path: string): string => `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n`;

/** A client that sends logins and can hang up. Not `fetch`, whose abort leaves the connection open on some Node versions. */
async function rawClient(requests: number, path: string): Promise<Socket> {
  const socket = connect((server.address() as AddressInfo).port, '127.0.0.1');
  socket.on('error', () => undefined);
  await once(socket, 'connect');
  socket.write(REQUEST(path).repeat(requests));
  return socket;
}

describe('authRateLimiter (production)', () => {
  it('does not count successful logins, so a shared IP can sign many users in', async () => {
    expect(await inTurn(200, 20)).toEqual(times(20, 200));
  });

  it('signs in everyone when more than the limit sign in at once from one IP (#419)', async () => {
    const release = hold();
    const answers = atOnce(200, 12);
    await arrivals(12);
    await handlerCalls(LIMIT);
    release();

    expect(statusesOf(await answers)).toEqual(times(12, 200));
  });

  it('signs in everyone at once with one failure left', async () => {
    await inTurn(401, LIMIT - 1);
    const release = hold();
    const answers = atOnce(200, 12);
    await arrivals(LIMIT - 1 + 12);
    expect(handled).toBe(LIMIT);
    release();

    expect(statusesOf(await answers)).toEqual(times(12, 200));
  });

  it('refuses one that comes while as many wait as may, and says to try again soon', async () => {
    const release = hold();
    const answers = atOnce(200, LIMIT + MAX_WAITING);
    await arrivals(LIMIT + MAX_WAITING);

    expect(await login(200)).toEqual({ status: 429, message: TOO_MANY_AT_ONCE, retryAfter: '5' });
    release();
    expect(statusesOf(await answers)).toEqual(times(LIMIT + MAX_WAITING, 200));
  });

  it('blocks the sixth failed login from one IP', async () => {
    expect(await inTurn(401, 6)).toEqual([...times(LIMIT, 401), 429]);
  });

  it.each([400, 403, 413, 429, 500, 503])('counts a login answered %s as failed', async (status) => {
    expect(await inTurn(status, LIMIT)).toEqual(times(LIMIT, status));
    expect((await login(200)).message).toBe(TOO_MANY_FAILED);
    expect(handled).toBe(LIMIT);
  });

  it('checks no more guesses than the limit when they come at once, and refuses the rest', async () => {
    const answers = statusesOf(await atOnce(401, 30));

    expect(answers.filter((s) => s === 401)).toHaveLength(LIMIT);
    expect(answers.filter((s) => s === 429)).toHaveLength(30 - LIMIT);
    expect(handled).toBe(LIMIT);
  });

  it('refuses a correct login too once the limit is reached, and says when to come back', async () => {
    await inTurn(401, LIMIT);

    const refused = await login(200);

    expect(refused).toMatchObject({ status: 429, message: TOO_MANY_FAILED });
    expect(Number(refused.retryAfter)).toBeGreaterThan(14 * 60);
    expect(Number(refused.retryAfter)).toBeLessThanOrEqual(15 * 60);
  });

  it('gives each guess made among correct logins its place: no more than the limit fail', async () => {
    const answers = statusesOf(await Promise.all(Array.from({ length: 40 }, (_v, i) => login(i % 2 === 0 ? 200 : 401))));

    expect(answers.filter((s) => s === 401)).toHaveLength(LIMIT);
  });

  it('counts a login whose client hung up before the answer, at once', async () => {
    hold();
    const clients = await Promise.all(Array.from({ length: LIMIT }, () => rawClient(1, '/login')));
    await handlerCalls(LIMIT);
    for (const client of clients) client.destroy();
    await openSockets(0);

    // Their handlers still run: only the hang-up can have counted them.
    expect((await login(200)).message).toBe(TOO_MANY_FAILED);
  });

  it('does not count a login whose client hung up while it waited for its turn, and does not check it', async () => {
    const release = hold();
    const answers = atOnce(200, LIMIT);
    await handlerCalls(LIMIT);
    const clients = await Promise.all(Array.from({ length: 10 }, () => rawClient(1, '/login?status=401')));
    await arrivals(LIMIT + 10);
    for (const client of clients) client.destroy();
    await openSockets(LIMIT);
    release();
    await answers;

    expect(await inTurn(200, 10)).toEqual(times(10, 200));
    expect(handled).toBe(LIMIT + 10);
    expect(await inTurn(401, LIMIT)).toEqual(times(LIMIT, 401));
  });

  it('counts and frees the places of logins sent down one connection that closed', async () => {
    const release = hold();
    const client = await rawClient(3, '/login');
    await handlerCalls(3);
    client.destroy();
    await openSockets(0);
    release();

    expect(await inTurn(401, LIMIT - 3)).toEqual(times(LIMIT - 3, 401));
    expect((await login(401)).message).toBe(TOO_MANY_FAILED);
  });

  it('takes no place for a login whose client hung up before the limiter saw it', async () => {
    for (let i = 0; i < LIMIT; i++) {
      const client = await rawClient(1, '/login-after-hang-up');
      await arrivals(i + 1);
      client.destroy();
    }
    await openSockets(0);

    expect(await inTurn(401, LIMIT)).toEqual(times(LIMIT, 401));
    expect(handled).toBe(LIMIT);
  });

  it('leaves no listener on a connection kept for many logins, and warns of none', async () => {
    const warnings: string[] = [];
    const note = (warning: Error): void => { warnings.push(warning.name); };
    process.on('warning', note);
    try {
      const client = await rawClient(1, '/login');
      await once(client, 'data');
      const listeners = sockets[0]!.listenerCount('close');
      client.write(REQUEST('/login').repeat(30));
      await handlerCalls(31);
      client.write(REQUEST('/login'));
      await handlerCalls(32);
      await new Promise((resolve) => { setTimeout(resolve, 50); });

      expect(sockets[0]!.listenerCount('close')).toBe(listeners);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(warnings).toEqual([]);
      // Nothing is kept for a login that was answered, so its connection's end tells nobody.
      const abort = vi.spyOn(AbortController.prototype, 'abort');
      client.destroy();
      await openSockets(0);
      expect(abort).not.toHaveBeenCalled();
      abort.mockRestore();
    } finally {
      process.off('warning', note);
    }
  });

  it('counts each client address on its own', async () => {
    for (let i = 0; i < LIMIT; i++) await login(401, { 'x-forwarded-for': '192.0.2.1' });

    expect((await login(200, { 'x-forwarded-for': '192.0.2.1' })).status).toBe(429);
    expect((await login(200, { 'x-forwarded-for': '192.0.2.2' })).status).toBe(200);
  });

  it('counts the addresses one IPv6 customer holds as one client', async () => {
    for (let i = 0; i < LIMIT; i++) await login(401, { 'x-forwarded-for': `2001:db8:0:${String(i)}::1` });

    expect((await login(401, { 'x-forwarded-for': '2001:db8:0:9::1' })).status).toBe(429);
  });
});

describe('refreshRateLimiter (production)', () => {
  it('allows far more refreshes than the login limit from one IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${base}/refresh`, { method: 'POST' });
      await res.text();
      statuses.push(res.status);
    }
    expect(statuses).toEqual(times(50, 200));
  });
});
