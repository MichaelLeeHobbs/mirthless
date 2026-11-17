// ===========================================
// API key daily row ceiling (real Postgres, #267 slice 12b)
// ===========================================
// A key with messages:read may read at most API_KEY_DAILY_ROWS message rows a
// UTC day through fail-closed reads; the read that would pass it is refused
// with 429 before anything is sent, recorded once (D-313). Each counted read
// records its rows, so the count survives a restart.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IssuedApiKey } from '@galvanigraph/core-models';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, unwrap, userWithRole,
  type ServerModules, type TestUser,
} from './_setup.js';

const CEILING = 3;

describeIntegration('API key daily row ceiling (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const CHANNEL = randomUUID();
  let lab: string;
  let admin: TestUser;
  let key: IssuedApiKey;
  let keyUser: string;
  const messageIds: number[] = [];

  beforeAll(async () => {
    // Read when the audited-read module loads, which the app import below does.
    process.env['API_KEY_DAILY_ROWS'] = String(CEILING);
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    process.env['API_KEY_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    lab = await insertTestGroup(mods.pool);
    await insertTestChannel(mods, CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [lab, CHANNEL]);
    for (let i = 0; i < 3; i++) {
      const [row] = await mods.db.insert(mods.schema.messages).values({ channelId: CHANNEL, serverId: 'itest' }).returning({ id: mods.schema.messages.id });
      unwrap(await mods.MessageService.createConnectorMessage(CHANNEL, row!.id, 0, 'Source', 'SENT'));
      messageIds.push(row!.id);
    }
    admin = await userWithRole(mods.pool, 'admin', null);
    users.push(admin.id);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const issued = await apiCall<IssuedApiKey>(base, admin.token, 'POST', '/api-keys', {
      name: 'Ceiling', permissions: ['channels:read', 'messages:read'], groupIds: [lab], expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(issued.status).toBe(201);
    key = issued.json.data!;
    keyUser = (await mods.pool.query<{ user_id: string }>('SELECT user_id FROM api_keys WHERE id = $1', [key.key.id])).rows[0]!.user_id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    await mods.pool.query(`DELETE FROM users WHERE id IN (SELECT user_id FROM api_keys WHERE issued_by = ANY($1::uuid[]))`, [users]);
    await mods.pool.query(`DELETE FROM roles WHERE key_role AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.role_id = roles.id)`);
    await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.db.delete(mods.schema.messages).where(mods.eq(mods.schema.messages.channelId, CHANNEL));
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await deleteTestChannel(mods, CHANNEL);
    await mods.pool.query('DELETE FROM channel_groups WHERE id = $1', [lab]);
    await mods.pool.end();
  });

  it('lets a key read up to the ceiling, then refuses with 429 and records it once', async () => {
    const first = await apiCall<{ items: unknown[] }>(base, key.token, 'GET', `/channels/${CHANNEL}/messages`);
    expect(first.status).toBe(200);
    expect(first.json.data!.items).toHaveLength(3);

    const again = await apiCall(base, key.token, 'GET', `/channels/${CHANNEL}/messages`);
    expect(again.status).toBe(429);
    expect(again.json.error?.message).toMatch(/3 message rows for today/);
    // One more row is too many too, whatever the read.
    expect((await apiCall(base, key.token, 'GET', `/channels/${CHANNEL}/messages/${String(messageIds[0])}`)).status).toBe(429);

    const reached = await mods.pool.query(`SELECT 1 FROM audit_log WHERE action = 'API_KEY_ROW_CEILING_REACHED' AND user_id = $1`, [keyUser]);
    expect(reached.rowCount).toBe(1);
  });

  it('records the rows of every counted read, so the day survives a restart', async () => {
    const { AuditService } = await import('../../src/services/audit.service.js');
    const since = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    expect(await AuditService.rowsReadSince(keyUser, since)).toBe(3);
    const searched = await mods.pool.query<{ rows: string }>(
      `SELECT attributes->>'rows' AS rows FROM audit_log WHERE action = 'MESSAGE_SEARCHED' AND user_id = $1`, [keyUser],
    );
    expect(searched.rows).toEqual([{ rows: '3' }]);
  });

  it('leaves a person\'s reads alone', async () => {
    expect((await apiCall(base, admin.token, 'GET', `/channels/${CHANNEL}/messages`)).status).toBe(200);
    expect((await apiCall(base, admin.token, 'GET', `/channels/${CHANNEL}/messages`)).status).toBe(200);
  });
});
