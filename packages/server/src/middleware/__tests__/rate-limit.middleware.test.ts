import { connect } from 'node:net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.stubEnv('NODE_ENV', 'production');

const LIMIT = 5;

/** A fresh limiter per test: they all sign in from one address. */
let server: Server;
let base = '';
let handled = 0;
/** Answers wait for it, when a test sets it. */
let held: Promise<void> | null = null;

beforeEach(async () => {
  vi.resetModules();
  const { authRateLimiter, refreshRateLimiter } = await import('../rate-limit.middleware.js');
  handled = 0;
  held = null;
  const app = express();
  app.set('trust proxy', 1);
  const handler = async (req: express.Request, res: express.Response): Promise<void> => {
    handled += 1;
    await held;
    res.status(Number(req.query['status'] ?? 200)).json({});
  };
  app.post('/login', authRateLimiter, handler);
  app.post('/refresh', refreshRateLimiter, handler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => { server.once('listening', () => { resolve(); }); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

async function post(path: string, init: RequestInit = {}): Promise<number> {
  const res = await fetch(`${base}${path}`, { method: 'POST', ...init });
  await res.text();
  return res.status;
}

async function inTurn(path: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push(await post(path));
  return statuses;
}

const atOnce = (path: string, times: number): Promise<number[]> => Promise.all(Array.from({ length: times }, () => post(path)));

function hold(): () => void {
  let release = (): void => undefined;
  held = new Promise((resolve) => { release = resolve; });
  return release;
}

const handlerCalls = (n: number): Promise<void> => vi.waitFor(() => { expect(handled).toBe(n); });

const connections = (n: number): Promise<void> => vi.waitFor(async () => {
  expect(await new Promise<number>((resolve) => { server.getConnections((_err, open) => { resolve(open); }); })).toBe(n);
});

describe('authRateLimiter (production)', () => {
  it('does not count successful logins, so a shared IP can sign many users in', async () => {
    expect(await inTurn('/login?status=200', 20)).toEqual(Array.from({ length: 20 }, () => 200));
  });

  it('signs in everyone when more than the limit sign in at once from one IP (#419)', async () => {
    const release = hold();
    const answers = atOnce('/login?status=200', 12);
    await handlerCalls(LIMIT);
    release();

    expect(await answers).toEqual(Array.from({ length: 12 }, () => 200));
  });

  it('signs in everyone at once with one failure left', async () => {
    await inTurn('/login?status=401', LIMIT - 1);
    const release = hold();
    const answers = atOnce('/login?status=200', 12);
    await handlerCalls(LIMIT);
    release();

    expect(await answers).toEqual(Array.from({ length: 12 }, () => 200));
  });

  it('blocks the sixth failed login from one IP', async () => {
    const statuses = await inTurn('/login?status=401', 6);

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('checks no more guesses than the limit when they come at once, and refuses the rest', async () => {
    const statuses = await atOnce('/login?status=401', 30);

    expect(statuses.filter((s) => s === 401)).toHaveLength(LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(30 - LIMIT);
    expect(handled).toBe(LIMIT);
  });

  it('refuses a correct login too once the limit is reached, and says when to come back', async () => {
    await inTurn('/login?status=401', LIMIT);

    const refused = await fetch(`${base}/login?status=200`, { method: 'POST' });

    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again in 15 minutes.' },
    });
    const seconds = Number(refused.headers.get('retry-after'));
    expect(seconds).toBeGreaterThan(14 * 60);
    expect(seconds).toBeLessThanOrEqual(15 * 60);
  });

  it('gives each guess made among correct logins its place: no more than the limit fail', async () => {
    const answers = await Promise.all(Array.from({ length: 40 }, (_v, i) => post(`/login?status=${i % 2 === 0 ? '200' : '401'}`)));

    expect(answers.filter((s) => s === 401)).toHaveLength(LIMIT);
  });

  it('counts a login whose client hung up before the answer', async () => {
    const release = hold();
    const gone = new AbortController();
    const cut = Array.from({ length: LIMIT }, () => post('/login?status=401', { signal: gone.signal }).catch(() => 'cut'));
    await handlerCalls(LIMIT);
    gone.abort();
    expect(await Promise.all(cut)).toEqual(Array.from({ length: LIMIT }, () => 'cut'));
    release();

    await vi.waitFor(async () => { expect(await post('/login?status=401')).toBe(429); });
    expect(handled).toBe(LIMIT);
  });

  it('does not count a login whose client hung up while it waited for its turn', async () => {
    const release = hold();
    const answers = atOnce('/login?status=200', LIMIT);
    await handlerCalls(LIMIT);
    const gone = new AbortController();
    const cut = Array.from({ length: 10 }, () => post('/login?status=401', { signal: gone.signal }).catch(() => 'cut'));
    await connections(LIMIT + 10);
    gone.abort();
    await Promise.all(cut);
    await connections(LIMIT);
    release();
    await answers;

    expect(await inTurn('/login?status=200', 10)).toEqual(Array.from({ length: 10 }, () => 200));
    expect(handled).toBe(LIMIT + 10);
  });

  // Node says nothing on the response of a pipelined request whose socket closed before its turn.
  it('frees the places of logins sent down one connection that closed', async () => {
    const release = hold();
    const socket = connect((server.address() as AddressInfo).port, '127.0.0.1');
    socket.on('error', () => undefined);
    socket.write('POST /login?status=200 HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n'.repeat(3));
    await handlerCalls(3);
    socket.destroy();
    await connections(0);
    release();

    // The three count as failures, as any login cut off does, and hold no place.
    expect(await inTurn('/login?status=200', 10)).toEqual(Array.from({ length: 10 }, () => 200));
    expect(await inTurn('/login?status=401', 3)).toEqual([401, 401, 429]);
  });

  it('counts each client address on its own', async () => {
    const from = (address: string, status: number): Promise<number> => post(`/login?status=${String(status)}`, { headers: { 'x-forwarded-for': address } });
    for (let i = 0; i < LIMIT; i++) await from('192.0.2.1', 401);

    expect(await from('192.0.2.1', 200)).toBe(429);
    expect(await from('192.0.2.2', 200)).toBe(200);
  });

  it('counts the addresses one IPv6 customer holds as one client', async () => {
    const from = (address: string): Promise<number> => post('/login?status=401', { headers: { 'x-forwarded-for': address } });
    for (let i = 0; i < LIMIT; i++) await from(`2001:db8:0:${String(i)}::1`);

    expect(await from('2001:db8:0:9::1')).toBe(429);
  });
});

describe('refreshRateLimiter (production)', () => {
  it('allows far more refreshes than the login limit from one IP', async () => {
    const statuses = await inTurn('/refresh', 50);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
