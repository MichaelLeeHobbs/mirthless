// #359: a change that depends on what its actor holds waits for a change taking
// that away, or is judged after it. Each race holds the narrowing open,
// uncommitted, while the actor's change runs.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { IssuedApiKey } from '@galvanigraph/core-models';
import { settleWithin } from '@galvanigraph/core-util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  apiCall, closeServer, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, listen, loadServerModules, userWithRole, WAIT,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';
import { INTEGRATION_WAIT_MS } from '../time-budgets.js';

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
    }, WAIT);
    return { result, waited };
  }

  async function raced<T>(held: Held, start: () => Promise<T>): Promise<T> {
    const { result } = await startAgainst(held, start);
    await held.release();
    return result;
  }

  /** A refused section answers 200 with an error for the library. */
  async function restoreLibrary(who: TestUser, id: string, channelIds: readonly string[] | null): Promise<number> {
    const answer = await call<{ sections: Array<{ section: string; errors: string[] }> }>(who, 'POST', '/system/backup', {
      backup: {
        version: 1, exportedAt: new Date().toISOString(), channels: [], codeTemplates: [], alerts: [], users: [], settings: [], resources: [], channelGroups: [], tags: [],
        globalMap: [], configMap: [], groupMemberships: [], tagAssignments: [], channelDependencies: [],
        globalScripts: { deploy: '', undeploy: '', preprocessor: '', postprocessor: '' },
        codeTemplateLibraries: [{ id, name: `itest-lib-${id.slice(0, 8)}`, description: null, channelIds }],
      },
      collisionMode: 'OVERWRITE',
    });
    const errors = answer.json.data?.sections.find((s) => s.section === 'codeTemplateLibraries')?.errors ?? [];
    return errors.some((e) => e.includes('system:restore')) ? 403 : errors.length > 0 ? 500 : answer.status;
  }

  interface Prepared { readonly run: () => Promise<number> }
  /**
   * `route` is what the route asks for and `needs` what the change gives or reaches. `lasting`:
   * needs access with no end, so shortening the actor's refuses it too.
   */
  interface Action { readonly name: string; readonly route: string; readonly needs: string; readonly lasting: boolean; readonly prepare: (who: TestUser) => Promise<Prepared> }

  const ACTIONS: readonly Action[] = [
    {
      name: 'setting a user\'s assignments', route: 'users:write', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const reader = await customRole(['channels:read']);
        const target = await user();
        return { run: () => status(call(who, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: null }] })) };
      },
    },
    {
      name: 'changing a user\'s single role', route: 'users:write', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const reader = await customRole(['channels:read']);
        const target = await user();
        return { run: () => status(call(who, 'PUT', `/users/${target.id}`, { role: reader.name })) };
      },
    },
    {
      name: 'creating a user', route: 'users:write', needs: 'channels:read', lasting: true,
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
      name: 'adding a permission to an assigned role', route: 'roles:write', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const held = await customRole([]);
        await userWithRole(mods.pool, held.name, null).then((u) => users.push(u.id));
        return { run: () => status(call(who, 'PUT', `/roles/${held.id}`, { permissions: ['channels:read'] })) };
      },
    },
    {
      name: 'adding a channel to a group', route: 'channels:write', needs: 'channels:read', lasting: true,
      prepare: async (who) => {
        const used = await group();
        await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
        await userWithRole(mods.pool, (await customRole(['channels:read'])).name, [used]).then((u) => users.push(u.id));
        return { run: () => status(call(who, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [used] })) };
      },
    },
    {
      name: 'restoring a membership', route: 'system:restore', needs: 'system:restore', lasting: true,
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
      name: 'taking a link out of a library', route: 'code_templates:write', needs: 'code_templates:write', lasting: true,
      prepare: async (who) => {
        const shared = await library(null);
        return { run: () => status(call(who, 'PUT', `/code-templates/libraries/${shared}`, { channelIds: [CHANNEL], revision: 1 })) };
      },
    },
    ...(['deleting', 'resetting the password of', 'enabling'] as const).map((verb): Action => ({
      name: `${verb} a user`, route: verb === 'deleting' ? 'users:delete' : 'users:write', needs: 'channels:read', lasting: verb !== 'deleting',
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
      name: 'resetting the password of a user with no access', route: 'users:write', needs: 'users:write', lasting: false,
      prepare: async (who) => {
        const target = await user();
        return { run: () => status(call(who, 'POST', `/users/${target.id}/password`, { newPassword: 'Itest-password-2!' })) };
      },
    },
    {
      name: 'restoring a membership that gives nothing', route: 'system:restore', needs: 'system:restore', lasting: false,
      prepare: async (who) => {
        const unused = await group();
        await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
        return {
          run: () => grants.restoreMembership(CHANNEL, unused, { userId: who.id })
            .then(() => 200, (err: unknown) => ((err as { code?: string }).code === 'FORBIDDEN' ? 403 : 500)),
        };
      },
    },
    ...([
      ['with fewer channels', [CHANNEL], true],
      ['with the same channels', null, false],
    ] as const).map(([what, channelIds, lasting]): Action => ({
      name: `restoring a library ${what}`, route: 'system:restore', needs: 'system:restore', lasting,
      prepare: async (who) => {
        const shared = await library(null);
        return { run: () => restoreLibrary(who, shared, channelIds) };
      },
    })),
    {
      name: 'taking over a leaver\'s API key', route: 'api_keys:manage', needs: 'api_keys:manage', lasting: false,
      prepare: async (who) => {
        const leaver = await userWithRole(mods.pool, (await customRole(['api_keys:manage', 'channels:read'])).name, null);
        users.push(leaver.id);
        const issued = await call<IssuedApiKey>(leaver, 'POST', '/api-keys', {
          name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + HOUR_MS / 2).toISOString(),
        });
        return { run: () => status(call(who, 'DELETE', `/users/${leaver.id}?takeOwnership=${issued.json.data!.key.id}`)) };
      },
    },
    ...([
      ['revoking', 'POST', 'revoke', { reason: 'Done with it' }],
      ['replacing', 'POST', 'replace', { mode: 'leak' }],
      ['enabling', 'PATCH', 'enabled', { enabled: true }],
    ] as const).map(([verb, method, path, body]): Action => ({
      name: `${verb} an API key`, route: 'api_keys:manage', needs: 'api_keys:manage', lasting: false,
      prepare: async (who) => {
        const issued = await call<IssuedApiKey>(admin, 'POST', '/api-keys', {
          name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + HOUR_MS / 2).toISOString(),
        });
        const id = issued.json.data!.key.id;
        if (verb === 'enabling') await call(admin, 'PATCH', `/api-keys/${id}/enabled`, { enabled: false });
        return { run: () => status(call(who, method, `/api-keys/${id}/${path}`, body)) };
      },
    })),
    {
      name: 'issuing an API key', route: 'api_keys:manage', needs: 'channels:read', lasting: true,
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
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
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

  it.each(ACTIONS)('refuses $name while the actor\'s role is losing the permission its route asks for', async ({ route, prepare }) => {
    const { who, roleId } = await actor();
    const { run } = await prepare(who);
    const permissions = EVERYTHING.filter((p) => p !== route);
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
      await mods.pool.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE NOWAIT', [who.id]);
      for (const table of ['users', 'channel_groups', 'api_keys']) {
        await mods.pool.query(`SELECT 1 FROM ${table} FOR NO KEY UPDATE NOWAIT`);
      }
      await mods.pool.query('SELECT 1 FROM roles WHERE NOT admin FOR UPDATE NOWAIT');
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

  it('makes taking a channel out of a group wait for a library being linked to it', async () => {
    const lab = await group();
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [lab, CHANNEL]);
    const mine = await library([CHANNEL]);
    const inLibrary = await hold((tx) => tx.execute(mods.sql`SELECT 1 FROM code_template_libraries WHERE id = ${mine} FOR UPDATE`));
    // A library update waits for its library row before the access lock, so this one takes neither yet.
    const linking = await startAgainst(inLibrary, () => status(call(admin, 'PUT', `/code-templates/libraries/${mine}`, { channelIds: [CHANNEL], revision: 1 })));
    expect(linking.waited).toBe(true);
    const inAccess = await hold(async (tx) => { await tx.execute(mods.sql`SELECT 1 FROM roles WHERE admin FOR NO KEY UPDATE`); });
    const leaving = await startAgainst(inAccess, () => status(call(admin, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [] })));
    try {
      expect(leaving.waited).toBe(true);
      await inLibrary.release();
      // Both now wait for the access lock, so one sees the other's result.
      await vi.waitFor(async () => {
        const { rows } = await mods.pool.query<{ n: string }>('SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = \'Lock\' AND datname = current_database()');
        expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(2);
      }, WAIT);
    } finally {
      await inAccess.release();
    }
    expect(await linking.result).toBe(200);
    expect(await leaving.result).toBe(200);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('runs every kind of access change at once without a deadlock, round %i', async (round) => {
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
    const shared = await library(null);
    await allAnswered({
      'restoring the library': restoreLibrary(two.who, shared, [CHANNEL]).then((s) => ({ status: s })),
      'taking a link out of the library': call(one.who, 'PUT', `/code-templates/libraries/${shared}`, { channelIds: [CHANNEL], revision: 1 }),
      'setting the first actor\'s assignments': call(admin, 'PUT', `/users/${one.who.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: scopes }] }),
      'setting a user\'s assignments': call(two.who, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: scopes }] }),
      'changing the second actor\'s role': call(one.who, 'PUT', `/roles/${two.roleId}`, { permissions: [...EVERYTHING] }),
      'changing the first actor\'s role': call(two.who, 'PUT', `/roles/${one.roleId}`, { permissions: EVERYTHING.filter((p) => p !== 'users:delete') }),
      'issuing a key': call(one.who, 'POST', '/api-keys', { name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read'], groupIds: scopes, expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString() }),
      'replacing the key': call(admin, 'POST', `/api-keys/${keyId}/replace`, { mode: 'leak' }),
      'disabling the key': call(one.who, 'PATCH', `/api-keys/${keyId}/enabled`, { enabled: false }),
      'enabling the key': call(two.who, 'PATCH', `/api-keys/${keyId}/enabled`, { enabled: true }),
      'setting the channel\'s groups': call(two.who, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: scopes }),
      'setting them in the other order': call(admin, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [...scopes].reverse() }),
      'setting them with the key': call(asKey, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [other] }),
      'changing the second actor': call(admin, 'PUT', `/users/${two.who.id}`, { role: reader.name, enabled: round % 3 !== 0 }),
      'deleting the first actor and taking the key over': call(admin, 'DELETE', `/users/${one.who.id}?takeOwnership=${keyId}`),
      'disabling the first actor': call(admin, 'PUT', `/users/${one.who.id}`, { email: `${one.who.id}@example.test`, enabled: false }),
      'revoking the spare key': call(one.who, 'POST', `/api-keys/${spareId}/revoke`, { reason: 'Done with it' }),
      'creating a user': call<{ id: string }>(two.who, 'POST', '/users', { username: `itest-new-${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password: 'Itest-password-1!', role: reader.name })
        .then((made) => { if (made.json.data) users.push(made.json.data.id); return made; }),
      'deleting a group': call(admin, 'DELETE', `/channel-groups/${other}`),
      'resetting a password': call(admin, 'POST', `/users/${target.id}/password`, { newPassword: 'Itest-password-2!' }),
      'restoring a membership': grants.restoreMembership(CHANNEL, used, { userId: two.who.id }).then(() => ({ status: 200 }), (err: unknown) => ({ status: (err as { code?: string }).code === 'FORBIDDEN' || pgCode(err) === '23505' ? 403 : 500 })),
    });
  });

  /**
   * With no answer at all meanwhile: on a slow host they come late, but they come. Half the time after
   * which the pool gives up on a connection, which would hide the deadlock.
   */
  const STUCK_MS = INTEGRATION_WAIT_MS / 2;

  /** Postgres ends a deadlock among its own locks, with a 500. One that also waits on this process never ends. */
  async function allAnswered(requests: Readonly<Record<string, Promise<{ readonly status: number }>>>): Promise<void> {
    const pending = new Set(Object.keys(requests));
    const failed: string[] = [];
    const answers = Object.entries(requests).map(async ([name, answer]) => {
      const { status: got } = await answer.finally(() => { pending.delete(name); });
      if (got >= 500) failed.push(`${name}: ${String(got)}`);
    });
    const all = Promise.all(answers);
    for (let left = pending.size; left > 0; left = pending.size) {
      if (await settleWithin(all, STUCK_MS)) break;
      if (pending.size === left) throw new Error(await whatIsStuck([...pending]));
    }
    await all;
    expect(failed).toEqual([]);
  }

  async function whatIsStuck(pending: readonly string[]): Promise<string> {
    const { totalCount, idleCount, waitingCount } = mods.pool;
    return [
      `Nothing answered for ${String(STUCK_MS / 1_000)} s. Unanswered: ${pending.join(', ')}.`,
      'Follow blocked_by to the backend nobody blocks. Idle in transaction for all that time, with requests waiting for a connection, is a deadlock. Active is work in progress.',
      `Pool: ${JSON.stringify({ totalCount, idleCount, waitingCount })}`,
      ...await backends().catch((err: unknown) => [`The backends could not be read: ${String(err)}`]),
    ].join('\n');
  }

  /** Through a connection of its own, because the pool may have none left. */
  async function backends(): Promise<string[]> {
    const client = new pg.Client({ connectionString: process.env['DATABASE_URL'], connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
    try {
      await client.connect();
      const { rows } = await client.query(`SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by,
          round(extract(epoch FROM clock_timestamp() - state_change))::int AS seconds, left(query, 120) AS query
        FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle' ORDER BY seconds DESC`);
      return rows.map((r) => JSON.stringify(r));
    } finally {
      void client.end().catch(() => undefined);
    }
  }

  function pgCode(err: unknown): unknown {
    return (err as { code?: unknown }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
  }
});
