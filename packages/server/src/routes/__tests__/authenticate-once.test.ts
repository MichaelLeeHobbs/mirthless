// ===========================================
// authenticate runs once per request (#217)
// ===========================================
// Ten routers share the /channels mount. When each ran `authenticate` itself, a
// request fell through every one of them on the way to its handler and loaded
// the user and the session up to ten times. The guard now runs once, where the
// API is mounted. This goes through the real route aggregator; only the guard
// (counted) and the channel controller (stubbed) are fake.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const calls = vi.hoisted(() => ({ authenticate: 0 }));

vi.mock('../../middleware/auth.middleware.js', async () => {
  const { builtInRolePermissions } = await import('../../db/seeds/roles.js');
  return {
    authenticate: (req: Request, _res: Response, next: NextFunction): void => {
      calls.authenticate++;
      req.user = {
        id: 'u1', username: 'admin', email: 'admin@test.local', role: 'admin', isActive: true,
        permissions: builtInRolePermissions('admin'), mustChangePassword: false,
      };
      // As authenticate does: the same permissions, on every channel.
      req.principal = { userId: 'u1', grants: new Map(builtInRolePermissions('admin').map((p) => [p, 'all' as const])) };
      next();
    },
  };
});
vi.mock('../../controllers/channel.controller.js', () => ({
  ChannelController: new Proxy({}, {
    get: (_target, method) => (_req: Request, res: Response): void => { res.json({ handler: String(method) }); },
  }),
}));

const routes = (await import('../index.js')).default;

const ID = '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c';
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/v1', routes);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

beforeEach(() => { calls.authenticate = 0; });

describe('authenticate', () => {
  it('runs once for a channel request that passes every router mounted on /channels', async () => {
    const res = await fetch(`${base}/channels/${ID}`);
    expect(await res.json()).toEqual({ handler: 'getById' });
    expect(calls.authenticate).toBe(1);
  });

  it('is not added again by any router; only logout, which sits above the guard, runs it itself', () => {
    const dir = new URL('../', import.meta.url);
    const withGuard = readdirSync(dir)
      .filter((name) => name.endsWith('.routes.ts'))
      .filter((name) => /\bauthenticate\b/.test(readFileSync(new URL(name, dir), 'utf8')));
    expect(withGuard).toEqual(['auth.routes.ts']);
  });
});
