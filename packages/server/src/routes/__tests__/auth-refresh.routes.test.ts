// The web keeps the permission list it got at sign-in, so a refresh must answer
// with the user as they are now (#219).

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { builtInRolePermissions } from '../../db/seeds/roles.js';

const state = vi.hoisted(() => ({ role: 'deployer', insertedUserAgents: [] as unknown[], deleteFails: false, tokenRefused: false }));

vi.mock('../../lib/db.js', () => {
  const session = { userId: 'u-1', expiresAt: new Date(Date.now() + 3_600_000) };
  const db = {
    // Each refresh consumes the session (DELETE ... RETURNING); the resolver reads the user.
    delete: () => ({ where: () => ({ returning: () => (state.deleteFails ? Promise.reject(new Error('Connection terminated due to connection timeout')) : Promise.resolve([session])) }) }),
    insert: () => ({
      values: (v: { userAgent?: unknown }) => {
        state.insertedUserAgents.push(v.userAgent);
        return { returning: () => Promise.resolve([{ id: 'sess-2' }]) };
      },
    }),
  };
  return { db, default: db };
});
vi.mock('../../lib/principal.js', async () => {
  const { standingFor } = await import('../../../test/standing.js');
  return {
    loadUserStanding: vi.fn(() => Promise.resolve(standingFor({ id: 'u-1', username: 'kpatel', email: 'kpatel@example.test', role: state.role }))),
    roleLabel: (names: readonly string[]) => names.join(', '),
  };
});
vi.mock('../../lib/jwt.js', () => ({
  verifyRefreshToken: vi.fn(() => { if (state.tokenRefused) throw new Error('invalid signature'); return { userId: 'u-1' }; }),
  signRefreshToken: vi.fn(() => 'next-refresh'),
  signAccessToken: vi.fn(() => 'next-access'),
  tokenExpiresAt: vi.fn(() => new Date(Date.now() + 3_600_000)),
}));
vi.mock('../../lib/logger.js', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
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
  state.deleteFails = false;
  state.tokenRefused = false;
});

interface RefreshBody {
  readonly success: boolean;
  readonly data?: {
    readonly accessToken: string;
    readonly user?: {
      readonly role: string; readonly permissions: readonly string[]; readonly mustChangePassword: boolean;
      readonly grants: readonly { readonly permission: string; readonly scope: unknown }[];
    };
  };
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
    expect(body.data?.user?.permissions).toEqual([...builtInRolePermissions('deployer')].sort());
  });

  it('carries each held permission with its scope (D-310)', async () => {
    const body = await refresh();
    expect(body.data?.user?.grants.map((g) => g.permission)).toEqual(body.data?.user?.permissions);
    expect(body.data?.user?.grants.every((g) => g.scope === 'all')).toBe(true);
  });

  it('shows a role change at the next refresh', async () => {
    expect((await refresh()).data?.user?.permissions).toContain('channels:deploy');

    state.role = 'viewer';
    const after = await refresh();

    expect(after.data?.user?.role).toBe('viewer');
    expect(after.data?.user?.permissions).toEqual([...builtInRolePermissions('viewer')].sort());
    expect(after.data?.user?.permissions).not.toContain('channels:deploy');
  });

  it('records the refreshing client on the new session', async () => {
    await refresh();
    expect(state.insertedUserAgents).toEqual(['itest-browser']);
  });
});

describe('POST /auth/refresh when the database cannot be read (#473)', () => {
  const post = (): Promise<Response> => fetch(`${base}/auth/refresh`, { method: 'POST', headers: { cookie: 'refreshToken=current-refresh' } });

  it('answers 503 and keeps the refresh cookie, so the person stays signed in', async () => {
    state.deleteFails = true;
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: { code: 'UNAVAILABLE', message: expect.any(String) } });
    expect(res.headers.get('set-cookie')).toBeNull();
    const logger = (await import('../../lib/logger.js')).default;
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ errMsg: 'Connection terminated due to connection timeout' }), expect.any(String));
  });

  it('still answers a refresh token that does not verify 401 and clears the cookie', async () => {
    state.tokenRefused = true;
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^refreshToken=;/);
  });
});
