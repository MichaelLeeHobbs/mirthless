// #359: a change that depends on what its actor holds waits for a change taking
// that away, or is judged after it. Each race holds the narrowing open,
// uncommitted, while the actor's change runs.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IssuedApiKey } from '@galvanigraph/core-models';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

type Tx = Parameters<Parameters<ServerModules['db']['transaction']>[0]>[0];

interface Held {
  readonly tx: Tx;
  readonly pid: number;
  readonly release: () => Promise<void>;
}

const HOUR_MS = 3_600_000;
const EVERYTHING = [
  'users:read', 'users:write', 'users:delete', 'roles:read', 'roles:write', 'channels:read', 'channels:write',
  'code_templates:read', 'code_templates:write', 'api_keys:read', 'api_keys:manage', 'system:restore',
] as const;

describeIntegration('the access lock (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let admin: TestUser;
  let grants: typeof import('../../src/services/grant.service.js').GrantService;
  const users: string[] = [];
  const groups: string[] = [];
  const roleIds: string[] = [];
  const libraries: string[] = [];
  const CHANNEL = randomUUID();

  const call = <T = unknown>(who: TestUser, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, who.token, method, path, body);
  const status = async (answer: Promise<ApiAnswer<unknown>>): Promise<number> => (await answer).status;

  async function user(role: string | null = null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, null);
    users.push(made.id);
    return made;
  }

  async function customRole(permissions: readonly string[]): Promise<{ id: string; name: string }> {
    const name = `itest-role-${randomUUID().slice(0, 8)}`;
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    const id = rows[0]!.id;
    roleIds.push(id);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [id, p]);
    return { id, name };
  }

  async function group(): Promise<string> {
    const id = await insertTestGroup(mods.pool);
    groups.push(id);
    return id;
  }

  async function library(channelIds: readonly string[] | null): Promise<string> {
    const { rows } = await mods.pool.query<{ id: string }>(
      'INSERT INTO code_template_libraries (name, channel_ids) VALUES ($1, $2::jsonb) RETURNING id',
      [`itest-lib-${randomUUID().slice(0, 8)}`, channelIds === null ? null : JSON.stringify(channelIds)],
    );
    libraries.push(rows[0]!.id);
    return rows[0]!.id;
  }

  async function actor(): Promise<{ who: TestUser; roleId: string }> {
    const role = await customRole(EVERYTHING);
    const who = await userWithRole(mods.pool, role.name, null);
    users.push(who.id);
    return { who, roleId: role.id };
  }

  /** Runs `work` in a transaction and keeps it open until released. */
  async function hold(work: (tx: Tx) => Promise<unknown>): Promise<Held> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let ready!: (held: Pick<Held, 'tx' | 'pid'>) => void;
    const opened = new Promise<Pick<Held, 'tx' | 'pid'>>((resolve) => { ready = resolve; });
    const done = mods.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ pid: number }>(mods.sql`SELECT pg_backend_pid() AS pid`);
      await work(tx);
      ready({ tx, pid: rows[0]!.pid });
      await released;
    });
    return { ...await Promise.race([opened, done.then(() => { throw new Error('not held'); })]), release: async () => { release(); await done; } };
  }

  /** Waits until the change is blocked by `held`, or has finished without waiting for it. */
  async function startAgainst<T>(held: Held, start: () => Promise<T>): Promise<{ readonly result: Promise<T>; readonly waited: boolean }> {
    let finished = false;
    const result = start().finally(() => { finished = true; });
    result.catch(() => undefined);
    let waited = false;
    await vi.waitFor(async () => {
      const { rows } = await mods.pool.query<{ n: string }>('SELECT count(*) AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [held.pid]);
      waited = Number(rows[0]!.n) > 0;
      if (!waited && !finished) throw new Error('neither waiting nor finished');
    }, { timeout: 10_000, interval: 20 });
    return { result, waited };
  }

  async function raced<T>(held: Held, start: () => Promise<T>): Promise<T> {
    const { result } = await startAgainst(held, start);
    await held.release();
    return result;
  }

  interface Prepared { readonly run: () => Promise<number> }
  /** `lasting`: needs access with no end, so shortening the actor's refuses it too. */
  interface Action { readonly name: string; readonly needs: string; readonly lasting: boolean; readonly prepare: (who: TestUser) => Promise<Prepared> }

  const ACTIONS: readonly Action[] = [
    {
      name: 'setting a user\'s assignments', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const reader = await customRole(['channels:read']);
        const target = await user();
        return { run: () => status(call(who, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: null }] })) };
      },
    },
    {
      name: 'changing a user\'s single role', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const reader = await customRole(['channels:read']);
        const target = await user();
        return { run: () => status(call(who, 'PUT', `/users/${target.id}`, { role: reader.name })) };
      },
    },
    {
      name: 'creating a user', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const reader = await customRole(['channels:read']);
        const name = `itest-new-${randomUUID().slice(0, 8)}`;
        return {
          run: async () => {
            const made = await call<{ id: string }>(who, 'POST', '/users', { username: name, email: `${name}@example.test`, password: 'Itest-password-1!', role: reader.name });
            if (made.json.data) users.push(made.json.data.id);
            return made.status;
          },
        };
      },
    },
    {
      name: 'adding a permission to an assigned role', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const held = await customRole([]);
        await userWithRole(mods.pool, held.name, null).then((u) => users.push(u.id));
        return { run: () => status(call(who, 'PUT', `/roles/${held.id}`, { permissions: ['channels:read'] })) };
      },
    },
    {
      name: 'adding a channel to a group', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const used = await group();
        await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
        await userWithRole(mods.pool, (await customRole(['channels:read'])).name, [used]).then((u) => users.push(u.id));
        return { run: () => status(call(who, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [used] })) };
      },
    },
    {
      name: 'restoring a membership', needs: 'system:restore', lasting: true,
      prepare: async (who) => {
        const used = await group();
        await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
        await userWithRole(mods.pool, (await customRole(['channels:read'])).name, [used]).then((u) => users.push(u.id));
        return {
          run: () => grants.restoreMembership(CHANNEL, used, { userId: who.id })
            .then(() => 200, (err: unknown) => ((err as { code?: string }).code === 'FORBIDDEN' ? 403 : 500)),
        };
      },
    },
    {
      name: 'taking a link out of a library', needs: 'code_templates:write', lasting: true,
      prepare: async (who) => {
        const shared = await library(null);
        return { run: () => status(call(who, 'PUT', `/code-templates/libraries/${shared}`, { channelIds: [CHANNEL], revision: 1 })) };
      },
    },
    ...(['deleting', 'resetting the password of', 'enabling'] as const).map((verb): Action => ({
      name: `${verb} a user`, needs: 'channels:read', lasting: verb !== 'deleting',
      prepare: async (who) => {
        const target = await userWithRole(mods.pool, (await customRole(['channels:read'])).name, null);
        users.push(target.id);
        if (verb === 'deleting') return { run: () => status(call(who, 'DELETE', `/users/${target.id}`)) };
        if (verb === 'enabling') {
          await mods.pool.query('UPDATE users SET enabled = false WHERE id = $1', [target.id]);
          return { run: () => status(call(who, 'PUT', `/users/${target.id}`, { enabled: true })) };
        }
        return { run: () => status(call(who, 'POST', `/users/${target.id}/password`, { newPassword: 'Itest-password-2!' })) };
      },
    })),
    {
      name: 'issuing an API key', needs: 'channels:read', lasting: true,
      prepare: async (who) => ({
        run: () => status(call(who, 'POST', '/api-keys', {
          name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
        })),
      }),
    },
  ];

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    ({ GrantService: grants } = await import('../../src/services/grant.service.js'));
    await insertTestChannel(mods, CHANNEL);
    admin = await user('admin');
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (libraries.length > 0) await mods.pool.query('DELETE FROM code_template_libraries WHERE id = ANY($1::uuid[])', [libraries]);
    await mods.pool.query('DELETE FROM users WHERE id IN (SELECT user_id FROM api_keys WHERE issued_by = ANY($1::uuid[]))', [users]);
    await mods.pool.query('DELETE FROM roles WHERE key_role AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.role_id = roles.id)');
    await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roleIds]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await deleteTestChannel(mods, CHANNEL);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it.each(ACTIONS.filter((a) => a.lasting))('refuses $name while the actor\'s access is being shortened', async ({ prepare }) => {
    const { who, roleId } = await actor();
    const { run } = await prepare(who);
    const soon = new Date(Date.now() + HOUR_MS).toISOString();
    const held = await hold((tx) => grants.setAssignments(tx, who.id, [{ roleId, groupIds: null, expiresAt: soon, reason: null }], { userId: admin.id }));

    expect(await raced(held, run)).toBe(403);
  });

  it.each(ACTIONS)('refuses $name while the actor\'s role is losing what it needs', async ({ needs, prepare }) => {
    const { who, roleId } = await actor();
    const { run } = await prepare(who);
    const permissions = EVERYTHING.filter((p) => p !== needs);
    const held = await hold((tx) => grants.updateRole(tx, roleId, { permissions: [...permissions] }, { userId: admin.id }));

    expect(await raced(held, run)).toBe(403);
  });

  it.each(ACTIONS)('allows $name when nothing changes the actor\'s access', async ({ prepare }) => {
    const { who } = await actor();
    const { run } = await prepare(who);

    expect([200, 201, 204]).toContain(await run());
  });

  // What setAssignments locks after the access lock. A change that held one of
  // these while waiting for the access lock would deadlock with it.
  it.each(ACTIONS)('holds no user, role, group or key while $name waits for the access lock', async ({ prepare }) => {
    const { who } = await actor();
    const { run } = await prepare(who);
    const held = await hold(async (tx) => { await tx.execute(mods.sql`SELECT 1 FROM roles WHERE admin FOR NO KEY UPDATE`); });
    const { result, waited } = await startAgainst(held, run);
    try {
      expect(waited).toBe(true);
      for (const table of ['users', 'channel_groups', 'api_keys']) {
        await mods.pool.query(`SELECT 1 FROM ${table} FOR UPDATE NOWAIT`);
      }
      await mods.pool.query('SELECT 1 FROM roles WHERE NOT admin FOR UPDATE NOWAIT');
    } finally {
      await held.release();
    }
    expect([200, 201, 204]).toContain(await result);
  });

  it.each([
    ['revoking', 'POST', 'revoke', { reason: 'Done with it' }],
    ['replacing', 'POST', 'replace', { mode: 'leak' }],
    ['enabling', 'PATCH', 'enabled', { enabled: true }],
  ] as const)('holds no key while %s one waits for the access lock', async (_name, method, path, body) => {
    const issued = await call<IssuedApiKey>(admin, 'POST', '/api-keys', {
      name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
    });
    const id = issued.json.data!.key.id;
    if (path === 'enabled') await call(admin, 'PATCH', `/api-keys/${id}/enabled`, { enabled: false });
    const held = await hold(async (tx) => { await tx.execute(mods.sql`SELECT 1 FROM roles WHERE admin FOR NO KEY UPDATE`); });
    const { result, waited } = await startAgainst(held, () => status(call(admin, method, `/api-keys/${id}/${path}`, body)));
    try {
      expect(waited).toBe(true);
      await mods.pool.query('SELECT 1 FROM api_keys WHERE id = $1 FOR UPDATE NOWAIT', [id]);
    } finally {
      await held.release();
    }
    expect([200, 201, 204]).toContain(await result);
  });

  it('holds no new user while creating one waits for the access lock, so an email change under it does not wait for that user', async () => {
    const name = `itest-new-${randomUUID().slice(0, 8)}`;
    const email = `${name}@example.test`;
    const held = await hold(async (tx) => { await tx.execute(mods.sql`SELECT 1 FROM roles WHERE admin FOR NO KEY UPDATE`); });
    const { result, waited } = await startAgainst(held, () => call<{ id: string }>(admin, 'POST', '/users', { username: name, email, password: 'Itest-password-1!', role: 'viewer' }));
    try {
      expect(waited).toBe(true);
      await held.tx.execute(mods.sql`SET LOCAL lock_timeout = '500ms'`);
      await held.tx.execute(mods.sql`UPDATE users SET email = ${email} WHERE id = ${admin.id}`);
      await held.tx.execute(mods.sql`UPDATE users SET email = ${`${admin.id}@example.test`} WHERE id = ${admin.id}`);
    } finally {
      await held.release();
    }
    const made = await result;
    if (made.json.data) users.push(made.json.data.id);
    expect(made.status).toBe(201);
  });

  it('gives access on a group without waiting for a channel being placed in it', async () => {
    const used = await group();
    const reader = await customRole(['channels:read']);
    const target = await user();
    // What creating a channel holds on the group until its partitions are made.
    const held = await hold(async (tx) => { await tx.execute(mods.sql`SELECT 1 FROM channel_groups WHERE id = ${used} FOR KEY SHARE`); });
    try {
      const { result, waited } = await startAgainst(held, () => status(call(admin, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: [used] }] })));
      expect(waited).toBe(false);
      expect(await result).toBe(200);
    } finally {
      await held.release();
    }
  });

  it('makes taking a channel out of a group wait for a library link that relies on it', async () => {
    const lab = await group();
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [lab, CHANNEL]);
    const writer = await userWithRole(mods.pool, (await customRole(['code_templates:write'])).name, [lab]);
    users.push(writer.id);
    const mine = await library([CHANNEL]);
    const held = await hold(async (tx) => { await grants.applyChannelGroups(tx, CHANNEL, [], { userId: admin.id }); await tx.execute(mods.sql`SELECT 1 FROM roles WHERE admin FOR NO KEY UPDATE`); });

    expect(await raced(held, () => status(call(writer, 'PUT', `/code-templates/libraries/${mine}`, { channelIds: [CHANNEL], revision: 1 })))).toBe(403);
  });

  it('runs every kind of access change at once without a deadlock', async () => {
    for (let round = 0; round < 8; round++) {
      const one = await actor();
      const two = await actor();
      const used = await group();
      const other = await group();
      const reader = await customRole(['channels:read']);
      const target = await user();
      await userWithRole(mods.pool, reader.name, [used]).then((u) => users.push(u.id));
      const key = await call<IssuedApiKey>(one.who, 'POST', '/api-keys', {
        name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
      });
      const keyId = key.json.data!.key.id;
      const spare = await call<IssuedApiKey>(one.who, 'POST', '/api-keys', {
        name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
      });
      const spareId = spare.json.data!.key.id;
      const asKey: TestUser = { id: '', token: key.json.data!.token };
      const scopes = round % 2 === 0 ? [used, other] : [other, used];
      const statuses = await Promise.all([
        call(admin, 'PUT', `/users/${one.who.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: scopes }] }),
        call(two.who, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: scopes }] }),
        call(one.who, 'PUT', `/roles/${two.roleId}`, { permissions: [...EVERYTHING] }),
        call(two.who, 'PUT', `/roles/${one.roleId}`, { permissions: EVERYTHING.filter((p) => p !== 'users:delete') }),
        call(one.who, 'POST', '/api-keys', { name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: scopes, expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString() }),
        call(admin, 'POST', `/api-keys/${keyId}/replace`, { mode: 'leak' }),
        call(one.who, 'PATCH', `/api-keys/${keyId}/enabled`, { enabled: false }),
        call(two.who, 'PATCH', `/api-keys/${keyId}/enabled`, { enabled: true }),
        call(two.who, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: scopes }),
        call(admin, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [...scopes].reverse() }),
        call(asKey, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [other] }),
        call(admin, 'PUT', `/users/${two.who.id}`, { role: reader.name, enabled: round % 3 !== 0 }),
        call(admin, 'DELETE', `/users/${one.who.id}?takeOwnership=${keyId}`),
        call(admin, 'PUT', `/users/${one.who.id}`, { email: `${one.who.id}@example.test`, enabled: false }),
        call(one.who, 'POST', `/api-keys/${spareId}/revoke`, { reason: 'Done with it' }),
        call<{ id: string }>(two.who, 'POST', '/users', { username: `itest-new-${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password: 'Itest-password-1!', role: reader.name })
          .then((made) => { if (made.json.data) users.push(made.json.data.id); return made; }),
        call(admin, 'DELETE', `/channel-groups/${other}`),
        call(admin, 'POST', `/users/${target.id}/password`, { newPassword: 'Itest-password-2!' }),
        grants.restoreMembership(CHANNEL, used, { userId: two.who.id }).then(() => ({ status: 200 }), (err: unknown) => ({ status: (err as { code?: string }).code === 'FORBIDDEN' || pgCode(err) === '23505' ? 403 : 500 })),
      ]);
      expect(statuses.map((s) => s.status).filter((s) => s >= 500), `round ${String(round)}`).toEqual([]);
    }
  });

  function pgCode(err: unknown): unknown {
    return (err as { code?: unknown }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
  }
});
