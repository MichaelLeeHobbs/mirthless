// What nobody may do to their own account through the user routes. Postgres reads
// a UUID in either case, so each is tried with the id as stored and in capitals.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiCall, describeIntegration, loadServerModules, userWithRole, type ApiAnswer, type ServerModules, type TestUser } from './_setup.js';

const NEW_PASSWORD = 'Itest-password-2!';

const FORMS = [
  ['as stored', (id: string) => id],
  ['in capitals', (id: string) => id.toUpperCase()],
] as const;

interface Account { readonly password_hash: string; readonly enabled: boolean; readonly sessions: string; readonly roles: readonly string[] }

describeIntegration('your own account (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];

  async function admin(): Promise<TestUser> {
    const made = await userWithRole(mods.pool, 'admin', null);
    users.push(made.id);
    return made;
  }

  const call = (who: TestUser, method: string, path: string, body?: unknown): Promise<ApiAnswer<unknown>> => apiCall(base, who.token, method, path, body);

  async function account(id: string): Promise<Account> {
    const { rows } = await mods.pool.query<Account>(
      `SELECT u.password_hash, u.enabled, (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
              ARRAY(SELECT r.name FROM assignments a JOIN roles r ON r.id = a.role_id WHERE a.user_id = u.id) AS roles
         FROM users u WHERE u.id = $1`, [id],
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    // Stays throughout, so no refusal below is the last-admin check's.
    await admin();
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.pool.end();
  });

  it.each(FORMS)('refuses resetting your own password, your id %s, and leaves the password and sessions as they were', async (_form, write) => {
    const who = await admin();
    const before = await account(who.id);

    const answer = await call(who, 'POST', `/users/${write(who.id)}/password`, { newPassword: NEW_PASSWORD });

    expect(answer.status).toBe(400);
    expect(answer.json.error?.code).toBe('SELF_ACTION');
    expect(await account(who.id)).toEqual(before);
  });

  it.each(FORMS)('refuses deleting your own account, your id %s', async (_form, write) => {
    const who = await admin();
    const before = await account(who.id);

    const answer = await call(who, 'DELETE', `/users/${write(who.id)}`);

    expect(answer.json.error?.code).toBe('SELF_ACTION');
    expect(await account(who.id)).toEqual(before);
  });

  it.each(FORMS)('refuses changing your own role, your id %s', async (_form, write) => {
    const who = await admin();
    const before = await account(who.id);

    const answer = await call(who, 'PUT', `/users/${write(who.id)}`, { role: 'viewer' });

    expect(answer.json.error?.code).toBe('SELF_ACTION');
    expect(await account(who.id)).toEqual(before);
  });

  it.each(FORMS)('refuses setting your own assignments, your id %s', async (_form, write) => {
    const who = await admin();
    const before = await account(who.id);

    const answer = await call(who, 'PUT', `/users/${write(who.id)}/assignments`, { assignments: [] });

    expect(answer.status).toBe(403);
    expect(answer.json.error?.message).toMatch(/your own access/);
    expect(await account(who.id)).toEqual(before);
  });

  it('resets another user\'s password and ends their sessions, and records the target\'s id as stored', async () => {
    const who = await admin();
    const target = await admin();
    const before = await account(target.id);

    const answer = await call(who, 'POST', `/users/${target.id.toUpperCase()}/password`, { newPassword: NEW_PASSWORD });

    expect(answer.status).toBe(204);
    const after = await account(target.id);
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(after.sessions).toBe('0');
    // Recording is fire-and-forget.
    await expect.poll(async () => {
      const { rows } = await mods.pool.query<{ attributes: { targetUserId?: string } }>(
        `SELECT attributes FROM events WHERE name = 'PASSWORD_CHANGED' AND user_id = $1`, [who.id],
      );
      return rows.map((r) => r.attributes.targetUserId);
    }).toEqual([target.id]);
  });

  it('answers 404 for a user that does not exist', async () => {
    expect((await call(await admin(), 'POST', `/users/${randomUUID()}/password`, { newPassword: NEW_PASSWORD })).status).toBe(404);
  });
});
