// Test Connection fills the references of the configuration map as a deploy does (#133). The caller
// names the server that gets the values, so it is only for one who can read them anyway.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, closeServer, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, listen, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('Test Connection and the configuration map (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const roleIds: string[] = [];
  const LAB_CHANNEL = randomUUID();
  const RAD_CHANNEL = randomUUID();
  const CATEGORY = `itest-${randomUUID().slice(0, 8)}`;
  /** Reserved, so the test stops at the address check, whose answer names it. */
  const HOST = '169.254.133.7';
  let lab: string;
  let rad: string;

  async function user(permissions: readonly string[], scope: readonly string[] | null): Promise<TestUser> {
    const name = `itest-role-${randomUUID().slice(0, 8)}`;
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    roleIds.push(rows[0]!.id);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [rows[0]!.id, p]);
    const made = await userWithRole(mods.pool, name, scope);
    users.push(made.id);
    return made;
  }

  /** Give the user a second role on these groups. */
  async function alsoHolds(who: TestUser, permissions: readonly string[], scope: readonly string[]): Promise<void> {
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [`itest-role-${randomUUID().slice(0, 8)}`]);
    roleIds.push(rows[0]!.id);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [rows[0]!.id, p]);
    for (const group of scope) {
      const assigned = await mods.pool.query<{ id: string }>('INSERT INTO assignments (user_id, role_id, all_channels) VALUES ($1, $2, false) RETURNING id', [who.id, rows[0]!.id]);
      await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [assigned.rows[0]!.id, group]);
    }
  }

  const test = (who: TestUser, properties: Record<string, unknown>, channelId?: string): Promise<ApiAnswer<unknown>> =>
    apiCall(base, who.token, 'POST', '/connectors/test', { connectorType: 'TCP_MLLP', mode: 'DESTINATION', properties, ...(channelId === undefined ? {} : { channelId }) });

  const REFERENCES = { host: `\${${CATEGORY}.host}`, port: `\${${CATEGORY}.port}` };

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    lab = await insertTestGroup(mods.pool);
    rad = await insertTestGroup(mods.pool);
    groups.push(lab, rad);
    await insertTestChannel(mods, LAB_CHANNEL);
    await insertTestChannel(mods, RAD_CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2), ($3, $4)', [lab, LAB_CHANNEL, rad, RAD_CHANNEL]);
    await mods.pool.query('INSERT INTO configuration (category, name, value) VALUES ($1, $2, $3), ($1, $4, $5)', [CATEGORY, 'host', HOST, 'port', '6661']);
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    await mods.pool.query('DELETE FROM configuration WHERE category = $1', [CATEGORY]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roleIds.length > 0) await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roleIds]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [[LAB_CHANNEL, RAD_CHANNEL]]);
    await deleteTestChannel(mods, LAB_CHANNEL);
    await deleteTestChannel(mods, RAD_CHANNEL);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  const expectFilled = (answer: ApiAnswer<unknown>): void => {
    expect(answer.status).toBe(400);
    expect(answer.json.error?.message).toContain(`Connection to ${HOST} is blocked`);
  };

  const expectRefused = (answer: ApiAnswer<unknown>): void => {
    expect(answer.status).toBe(403);
    expect(answer.json.error?.message).toContain('config_map:read');
    expect(JSON.stringify(answer.json)).not.toContain(HOST);
  };

  it('fills them for a deployer, who reads the map, with and without a channel', async () => {
    const deployer = await userWithRole(mods.pool, 'deployer', null);
    users.push(deployer.id);

    expectFilled(await test(deployer, REFERENCES));
    expectFilled(await test(deployer, REFERENCES, LAB_CHANNEL));
  });

  it('fills them for one who reads the map and writes no channel', async () => {
    expectFilled(await test(await user(['channels:deploy', 'config_map:read'], null), REFERENCES));
  });

  it('fills them for one who writes the scripts of the channel, which read the map', async () => {
    expectFilled(await test(await user(['channels:read', 'channels:write', 'channels:deploy'], [lab]), REFERENCES, LAB_CHANNEL));
    expectFilled(await test(await user(['channels:write', 'channels:deploy'], null), REFERENCES));
  });

  it('refuses one who may deploy but not read the map, and tests what that one typed', async () => {
    const releaser = await user(['channels:read', 'channels:deploy'], null);

    expectRefused(await test(releaser, REFERENCES));
    expectRefused(await test(releaser, REFERENCES, LAB_CHANNEL));
    expectRefused(await test(releaser, { host: 'example.test', port: REFERENCES.port }));
    const typed = await test(releaser, { host: '169.254.1.1', port: 6661 });
    expect(typed.json.error?.message).toContain('Connection to 169.254.1.1 is blocked');
    // Not in the map, so it is filled per message.
    const perMessage = await test(releaser, { host: '169.254.1.1', port: 6661, template: '${oru}' });
    expect(perMessage.json.error?.message).toContain('Connection to 169.254.1.1 is blocked');
  });

  it('refuses one who writes another group\'s channels only', async () => {
    const releaser = await user(['channels:read', 'channels:deploy'], null);
    await alsoHolds(releaser, ['channels:write'], [rad]);

    expectRefused(await test(releaser, REFERENCES, LAB_CHANNEL));
    expectRefused(await test(releaser, REFERENCES));
    expectFilled(await test(releaser, REFERENCES, RAD_CHANNEL));
  });

  it('checks the settings as a deploy does, with the values filled', async () => {
    const deployer = await userWithRole(mods.pool, 'deployer', null);
    users.push(deployer.id);

    const answer = await test(deployer, { host: REFERENCES.port, port: REFERENCES.host });

    expect(answer.status).toBe(400);
    expect(answer.json.error?.message).toMatch(/^Invalid destination connector properties for TCP_MLLP: port: /);
  });
});
