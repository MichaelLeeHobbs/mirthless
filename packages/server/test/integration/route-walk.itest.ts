// ===========================================
// Route walk per principal (real authenticate, real Postgres)
// ===========================================
// public-routes.test.ts proves every non-public route refuses a caller with no
// session (D-299). This walks the same routes signed in as each seeded role, and
// as a disabled user, a user who must change their password and a revoked
// session. Nothing is mocked: each caller is a users row with a sessions row and
// a token the server signed, so the real authenticate resolves who they are.
//
// For each role and route:
// - a role without the route's permission gets the guard's 403;
// - a role with it gets past the guard. GETs run their handler. Other methods
//   are sent input their validator refuses, so the 400 shows the guard let them
//   through and nothing changed. A non-GET route with no validator would run on
//   any request (POST /admin/prune prunes every channel), so it is not called.
//
// Refusals are recorded once a minute per caller, route and reason (#158); the
// last tests read those records back from audit_log.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER_ROLE } from '@galvanigraph/core-models';
import { builtInRolePermissions, defaultRoles } from '../../src/db/seeds/roles.js';
import { describeIntegration } from './_setup.js';
import type { ApiRoute, WalkedRoute } from '../../src/routes/__tests__/api-routes.js';

const ID = '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c';
const NOT_AN_ID = 'route-walk-not-an-id';
/** Every built-in role, the channel roles included (D-310). */
const ROLES = defaultRoles.map((r) => r.name);
/** What authenticate still lets through for a user who must change their password. */
const PASSWORD_CHANGE_EXEMPT: readonly ApiRoute[] = [
  { method: 'POST', path: '/api/v1/users/me/password' },
  { method: 'POST', path: '/api/v1/auth/logout' },
];

/**
 * Non-GET routes whose handler would run on any request the walk could send,
 * so a role that passes the guard does not call them. Their refusals are still walked.
 */
const NOT_CALLED_WHEN_ALLOWED: ReadonlyArray<ApiRoute & { readonly reason: string }> = [
  { method: 'POST', path: '/api/v1/admin/prune', reason: 'No validator: prunes every channel.' },
  { method: 'DELETE', path: '/api/v1/global-map', reason: 'No validator: clears the global map.' },
  { method: 'DELETE', path: '/api/v1/global-map/:key', reason: 'The key is free text, so the validator accepts any.' },
  { method: 'DELETE', path: '/api/v1/config-map/:category/:name', reason: 'The category and name are free text.' },
  { method: 'DELETE', path: '/api/v1/settings/:key', reason: 'The key is free text.' },
];

interface Answer {
  readonly status: number;
  readonly code: string | undefined;
  readonly message: string | undefined;
}

interface Caller {
  readonly id: string;
  readonly token: string;
}

const label = (r: ApiRoute): string => `${r.method} ${r.path}`;
const same = (a: ApiRoute) => (b: ApiRoute): boolean => a.method === b.method && a.path === b.path;
const isGuardRefusal = (a: Answer): boolean => a.status === 403 && a.code === 'FORBIDDEN' && a.message === 'Forbidden';

describeIntegration('route walk per principal (real authenticate)', () => {
  let pool: typeof import('../../src/lib/db.js').pool;
  let permissionsOfGuard: typeof import('../../src/middleware/permission.middleware.js').permissionsOfGuard;
  let isValidator: typeof import('../../src/middleware/validate.middleware.js').isValidator;
  let server: Server;
  let base: string;
  let routes: readonly WalkedRoute[];
  const callers = new Map<string, Caller>();

  async function createCaller(name: string, role: string, flags: { enabled?: boolean; mustChange?: boolean } = {}): Promise<Caller> {
    const { signAccessToken } = await import('../../src/lib/jwt.js');
    const username = `itest-walk-${name}-${randomUUID().slice(0, 8)}`;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash, enabled, must_change_password)
       VALUES ($1, $2, 'not-a-hash', $3, $4) RETURNING id`,
      [username, `${username}@example.test`, flags.enabled ?? true, flags.mustChange ?? false],
    );
    const id = rows[0]?.id ?? '';
    await pool.query(
      `INSERT INTO assignments (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2`,
      [id, role],
    );
    const session = await pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING id`,
      [id, `itest-walk-${randomUUID()}`],
    );
    const caller = { id, token: signAccessToken({ userId: id, sessionId: session.rows[0]?.id ?? '' }) };
    callers.set(name, caller);
    return caller;
  }

  beforeAll(async () => {
    // Over a thousand requests from one address: lift the API limiter for this file only.
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    ({ pool } = await import('../../src/lib/db.js'));
    ({ permissionsOfGuard } = await import('../../src/middleware/permission.middleware.js'));
    ({ isValidator } = await import('../../src/middleware/validate.middleware.js'));
    const { walkApiRoutes, isPublic, SESSION_ONLY_ROUTES } = await import('../../src/routes/__tests__/api-routes.js');
    const app = (await import('../../src/app.js')).default;
    routes = (await walkApiRoutes((await import('../../src/routes/index.js')).default)).filter((r) => !isPublic(r));
    // Session-only routes act on the caller's own session; logout would end the walk's.
    routes = routes.filter((r) => !SESSION_ONLY_ROUTES.some(same(r)) || permissionsOfGuard(r.handlers[0]) !== undefined);
    for (const role of ROLES) await createCaller(role, role);
    await createCaller('disabled', USER_ROLE.ADMIN, { enabled: false });
    await createCaller('must-change', USER_ROLE.ADMIN, { mustChange: true });
    const revoked = await createCaller('revoked', USER_ROLE.ADMIN);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [revoked.id]);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }, 120_000);

  afterAll(async () => {
    const running = server as Server | undefined;
    if (running) await new Promise<void>((resolve) => { running.close(() => { resolve(); }); });
    const ids = [...callers.values()].map((c) => c.id);
    if (ids.length > 0) {
      // Their ACCESS_DENIED rows stay: audit_log refuses deletes, and has no key to users.
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    await pool?.end();
  });

  function caller(name: string): Caller {
    const c = callers.get(name);
    if (!c) throw new Error(`no caller ${name}`);
    return c;
  }

  async function call(route: ApiRoute, token: string, input: { readonly param: string; readonly body?: string }): Promise<Answer> {
    const res = await fetch(`${base}${route.path.replace(/:\w+/g, input.param)}`, {
      method: route.method,
      headers: { connection: 'close', authorization: `Bearer ${token}`, ...(input.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    return { status: res.status, code: json.error?.code, message: json.error?.message };
  }

  const guardOf = (r: WalkedRoute): readonly string[] => permissionsOfGuard(r.handlers[0]) ?? [];
  const holds = (role: string, r: WalkedRoute): boolean => guardOf(r).some((p) => (builtInRolePermissions(role) as readonly string[]).includes(p));
  /** A non-GET route the walk may call as a role that passes its guard: one whose validator refuses the walk's input first. */
  const safeToPass = (r: WalkedRoute): boolean =>
    r.method === 'GET' || (r.handlers.some((h) => isValidator(h)) && !NOT_CALLED_WHEN_ALLOWED.some(same(r)));

  it('walks a guarded route set, and a role reaches a non-GET route only through its validator', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.every((r) => guardOf(r).length > 0)).toBe(true);
    // Every non-GET route with no validator must be listed, so a new one is not called by accident.
    const noValidator = routes.filter((r) => r.method !== 'GET' && !r.handlers.some((h) => isValidator(h)));
    for (const r of noValidator) expect(NOT_CALLED_WHEN_ALLOWED.some(same(r)), label(r)).toBe(true);
    for (const r of NOT_CALLED_WHEN_ALLOWED) expect(routes.some(same(r)), label(r)).toBe(true);
  });

  it.each(ROLES)('lets %s through exactly the guards whose permission it holds', async (role) => {
    const wrong: string[] = [];
    for (const route of routes) {
      if (!holds(role, route)) {
        const answer = await call(route, caller(role).token, { param: ID });
        if (!isGuardRefusal(answer)) wrong.push(`${label(route)}: refused expected, got ${String(answer.status)}`);
        continue;
      }
      if (!safeToPass(route)) continue;
      const answer = route.method === 'GET'
        ? await call(route, caller(role).token, { param: ID })
        : await call(route, caller(role).token, { param: NOT_AN_ID, body: '[]' });
      if (answer.status === 401 || isGuardRefusal(answer)) wrong.push(`${label(route)}: allowed expected, got ${String(answer.status)}`);
      else if (route.method !== 'GET' && answer.code !== 'VALIDATION_ERROR') wrong.push(`${label(route)}: the handler ran (${String(answer.status)})`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it.each([
    ['disabled', 403, 'ACCOUNT_DEACTIVATED'],
    ['must-change', 403, 'PASSWORD_CHANGE_REQUIRED'],
    ['revoked', 401, 'UNAUTHORIZED'],
  ] as const)('refuses a %s caller on every route before its guard', async (name, status, code) => {
    const wrong: string[] = [];
    for (const route of routes) {
      if (name === 'must-change' && PASSWORD_CHANGE_EXEMPT.some(same(route))) continue;
      const answer = await call(route, caller(name).token, { param: ID });
      if (answer.status !== status || answer.code !== code) wrong.push(`${label(route)}: ${String(answer.status)} ${String(answer.code)}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  /**
   * The ACCESS_DENIED records that open a window for one user, as route and
   * reason. A run that crosses a minute also gets the sweep's held-back counts
   * (repeatsSinceLast above 0), which these checks leave out. Recording is
   * fire-and-forget, so callers poll.
   */
  async function refusalsOf(userId: string): Promise<readonly string[]> {
    const { rows } = await pool.query<{ attributes: { method: string; route: string | null; reason: string } }>(
      `SELECT attributes FROM audit_log WHERE action = 'ACCESS_DENIED' AND user_id = $1
         AND (attributes->>'repeatsSinceLast')::int = 0`, [userId],
    );
    return rows.map((r) => `${r.attributes.method} ${r.attributes.route ?? '(before routing)'} ${r.attributes.reason}`).sort();
  }

  it('recorded each route a viewer was refused once, by template, and a repeat within the minute adds nothing', async () => {
    const viewer = caller(USER_ROLE.VIEWER);
    const refused = routes.filter((r) => !holds(USER_ROLE.VIEWER, r));
    const expected = refused.map((r) => `${label(r)} no_permission`).sort();
    await expect.poll(() => refusalsOf(viewer.id), { timeout: 10_000 }).toEqual(expected);

    const first = refused[0];
    if (!first) throw new Error('the viewer is refused nothing');
    await call(first, viewer.token, { param: ID });
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    expect(await refusalsOf(viewer.id)).toEqual(expected);
  });

  it.each([
    ['disabled', 'account_disabled'],
    ['must-change', 'password_change_required'],
    ['revoked', 'session_revoked'],
  ] as const)('recorded the %s caller once per method, before routing, across every route it was sent to', async (name, reason) => {
    // Before routing there is no template, so each method is one record whatever the path.
    const methods = [...new Set(routes.map((r) => r.method))];
    await expect.poll(() => refusalsOf(caller(name).id), { timeout: 10_000 })
      .toEqual(methods.map((m) => `${m} (before routing) ${reason}`).sort());
  });
});
