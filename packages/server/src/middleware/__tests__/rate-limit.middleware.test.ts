// ===========================================
// Auth Rate Limiter Behaviour Tests
// ===========================================
// Production limits, exercised over real HTTP: failed logins are capped,
// successful logins and token refreshes from one shared IP are not.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.stubEnv('NODE_ENV', 'production');
const { authRateLimiter, refreshRateLimiter } = await import('../rate-limit.middleware.js');

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  // The status the handler returns is chosen by the test via ?status=.
  const handler = (req: express.Request, res: express.Response): void => {
    res.status(Number(req.query['status'] ?? 200)).json({});
  };
  app.post('/login', authRateLimiter, handler);
  app.post('/refresh', refreshRateLimiter, handler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => { server.once('listening', () => { resolve(); }); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

async function post(path: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    statuses.push((await fetch(`${base}${path}`, { method: 'POST' })).status);
  }
  return statuses;
}

describe('authRateLimiter (production)', () => {
  it('does not count successful logins, so a shared IP can sign many users in', async () => {
    const statuses = await post('/login?status=200', 20);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('blocks the sixth failed login from one IP', async () => {
    const statuses = await post('/login?status=401', 6);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('refreshRateLimiter (production)', () => {
  it('allows far more refreshes than the login limit from one IP', async () => {
    const statuses = await post('/refresh', 50);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
