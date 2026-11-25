// A username or an email another account has.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, closeServer, describeIntegration, listen, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('a taken username or email (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let admin: TestUser;
  const users: string[] = [];

  const call = <T>(method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, admin.token, method, path, body);

  async function person(): Promise<{ readonly id: string; readonly email: string }> {
    const made = await userWithRole(mods.pool, 'viewer', null);
    users.push(made.id);
    const { rows } = await mods.pool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [made.id]);
    return { id: made.id, email: rows[0]!.email };
  }

  async function stored(id: string): Promise<Record<string, unknown>> {
    const { rows } = await mods.pool.query<Record<string, unknown>>(
      `SELECT email, first_name, enabled, (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions FROM users u WHERE id = $1`, [id],
    );
    return rows[0]!;
  }

  async function create(username: string, email: string): Promise<ApiAnswer<{ readonly id: string }>> {
    const answer = await call<{ readonly id: string }>('POST', '/users', { username, email, password: 'Itest-password-1!', role: 'viewer' });
    if (answer.json.data) users.push(answer.json.data.id);
    return answer;
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    admin = await userWithRole(mods.pool, 'admin', null);
    users.push(admin.id);
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.pool.end();
  });

  it('answers 409 when an edit takes another account\'s email, and changes nothing sent with it (#419)', async () => {
    const [one, other] = [await person(), await person()];
    const before = await stored(one.id);

    const answer = await call('PUT', `/users/${one.id}`, { email: other.email, firstName: 'Changed', enabled: false });

    expect(answer.status).toBe(409);
    expect(answer.json.error).toEqual({ code: 'ALREADY_EXISTS', message: `Email already in use: ${other.email}` });
    expect(await stored(one.id)).toEqual(before);
    const { rows } = await mods.pool.query(`SELECT 1 FROM audit_log WHERE action = 'USER_ENABLED_CHANGED' AND attributes->>'targetUserId' = $1`, [one.id]);
    expect(rows).toEqual([]);
  });

  it('answers 409 when the email is a disabled account\'s', async () => {
    const [one, other] = [await person(), await person()];
    await mods.pool.query('UPDATE users SET enabled = false WHERE id = $1', [other.id]);

    expect((await call('PUT', `/users/${one.id}`, { email: other.email })).status).toBe(409);
  });

  it('saves an edit that sends the account\'s own email', async () => {
    const one = await person();

    const answer = await call('PUT', `/users/${one.id}`, { email: one.email, firstName: 'Changed' });

    expect(answer.status).toBe(200);
    expect(await stored(one.id)).toMatchObject({ email: one.email, first_name: 'Changed' });
  });

  // Both pass the check made before the password is hashed, which takes longer than it.
  it.each([
    ['email', 'Email already in use: '],
    ['username', 'Username already taken: '],
  ])('makes one account and answers 409 for the other when two with one %s are created at once', async (what, message) => {
    const tag = `itest-${randomUUID().slice(0, 8)}`;

    const answers = await Promise.all([1, 2].map((n) => create(
      what === 'username' ? tag : `${tag}-${String(n)}`, what === 'email' ? `${tag}@example.test` : `${tag}-${String(n)}@example.test`,
    )));

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    const refused = answers.find((a) => a.status === 409)!;
    expect(refused.json.error?.code).toBe('ALREADY_EXISTS');
    expect(refused.json.error?.message).toContain(message);
  });
});
