// ===========================================
// POST /auth/refresh returns the user's current permissions (#219)
// ===========================================
// The web keeps the permission list it was given at sign-in. A refresh answers
// with the user as they are now, so a role change reaches the browser at the
// next refresh instead of the next sign-in. The request goes through the real
// router, controller and service; only the database and token signing are fake.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { permissionNamesForRole } from '../../lib/role-permissions.js';

const state = vi.hoisted(() => ({ role: 'deployer', insertedUserAgents: [] as unknown[] }));

vi.mock('../../lib/db.js', () => {
  const session = { userId: 'u-1', expiresAt: new Date(Date.now() + 3_600_000) };
  const db = {
    // Each refresh consumes the session (DELETE ... RETURNING), then reads the user.
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([session]) }) }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{
          id: 'u-1', username: 'kpatel', email: 'kpatel@example.test', role: state.role, enabled: true, mustChangePassword: false,
        }]),
      }),
    }),
    insert: () => ({
      values: (v: { userAgent?: unknown }) => {
        state.insertedUserAgents.push(v.userAgent);
        return { returning: () => Promise.resolve([{ id: 'sess-2' }]) };
      },
    }),
  };
  return { db, default: db };
});
vi.mock('../../lib/jwt.js', () => ({
  verifyRefreshToken: vi.fn(() => ({ userId: 'u-1' })),
  signRefreshToken: vi.fn(() => 'next-refresh'),
  signAccessToken: vi.fn(() => 'next-access'),
  tokenExpiresAt: vi.fn(() => new Date(Date.now() + 3_600_000)),
}));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn(), emitAuditEvent: vi.fn() }));
vi.mock('../../middleware/rate-limit.middleware.js', () => ({
  authRateLimiter: (_req: unknown, _res: unknown, next: () => void): void => { next(); },
  refreshRateLimiter: (_req: unknown, _res: unknown, next: () => void): void => { next(); },
}));

const authRoutes = (await import('../auth.routes.js')).default;

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use('/auth', authRoutes);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

beforeEach(() => {
  state.role = 'deployer';
  state.insertedUserAgents.length = 0;
});

interface RefreshBody {
  readonly success: boolean;
  readonly data?: { readonly accessToken: string; readonly user?: { readonly role: string; readonly permissions: readonly string[]; readonly mustChangePassword: boolean } };
}

async function refresh(): Promise<RefreshBody> {
  const res = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: 'refreshToken=current-refresh', 'user-agent': 'itest-browser' },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RefreshBody;
}

describe('POST /auth/refresh', () => {
  it('returns the new access token and the user with their current role and permissions', async () => {
    const body = await refresh();
    expect(body.data?.accessToken).toBe('next-access');
    expect(body.data?.user).toMatchObject({ role: 'deployer', mustChangePassword: false });
    expect(body.data?.user?.permissions).toEqual(permissionNamesForRole('deployer'));
  });

  it('shows a role change at the next refresh', async () => {
    expect((await refresh()).data?.user?.permissions).toContain('channels:deploy');

    state.role = 'viewer'; // an admin demotes the user
    const after = await refresh();

    expect(after.data?.user?.role).toBe('viewer');
    expect(after.data?.user?.permissions).toEqual(permissionNamesForRole('viewer'));
    expect(after.data?.user?.permissions).not.toContain('channels:deploy');
  });

  it('records the refreshing client on the new session', async () => {
    await refresh();
    expect(state.insertedUserAgents).toEqual(['itest-browser']);
  });
});
