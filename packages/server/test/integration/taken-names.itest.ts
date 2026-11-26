// A name two requests take at once (#450). Both pass the check made before the
// write: here the other one's row is held uncommitted, so the check misses it
// and the write waits on the unique index until it commits. The data source
// cases store an encrypted password, so they need CONTENT_ENCRYPTION_KEY.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, closeServer, deleteTestChannel, describeIntegration, insertTestChannel, listen, loadServerModules, userWithRole, waitForBlocked,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

interface Kind {
  readonly table: string;
  readonly path: string;
  readonly label: string;
  readonly body: (name: string) => Record<string, unknown>;
  /** The update sends the revision it read. */
  readonly revised: boolean;
}

const KINDS: readonly Kind[] = [
  { table: 'channel_tags', path: '/tags', label: 'Tag', body: (name) => ({ name, color: '#336699' }), revised: false },
  { table: 'channel_groups', path: '/channel-groups', label: 'Channel group', body: (name) => ({ name }), revised: true },
  { table: 'alerts', path: '/alerts', label: 'Alert', body: (name) => ({ name, trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'] } }), revised: true },
  { table: 'code_template_libraries', path: '/code-templates/libraries', label: 'Library', body: (name) => ({ name }), revised: true },
  { table: 'collections', path: '/collections', label: 'Collection', body: (name) => ({ name, indexedFields: ['mrn'] }), revised: false },
  {
    table: 'data_sources', path: '/datasources', label: 'Data source',
    body: (name) => ({ name, host: 'localhost', database: 'itest', user: 'itest', password: 'itest' }), revised: false,
  },
  { table: 'resources', path: '/resources', label: 'Resource', body: (name) => ({ name, mimeType: 'text/plain', content: 'itest' }), revised: false },
  // Made in SQL: a create parses its PEM, which a placeholder is not. An update that sends only a name reads none.
  { table: 'certificates', path: '/certificates', label: 'Certificate', body: (name) => ({ name }), revised: false },
];

describeIntegration('a name two requests take at once (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let admin: TestUser;
  const made: Array<{ readonly table: string; readonly id: string }> = [];
  const channels: string[] = [];

  const call = <T>(method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, admin.token, method, path, body);
  const fresh = (): string => `itest-450-${randomUUID().slice(0, 8)}`;

  async function make(kind: Kind): Promise<{ readonly id: string; readonly revision?: number }> {
    if (kind.table === 'certificates') {
      const { rows } = await mods.pool.query<{ id: string }>(
        `INSERT INTO certificates (name, type, certificate_pem, fingerprint, issuer, subject, not_before, not_after)
         VALUES ($1, 'CA', 'placeholder', 'placeholder', 'CN=itest', 'CN=itest', now(), now() + interval '1 day') RETURNING id`, [fresh()],
      );
      made.push({ table: kind.table, id: rows[0]!.id });
      return rows[0]!;
    }
    const answer = await call<{ readonly id: string; readonly revision?: number }>('POST', kind.path, kind.body(fresh()));
    expect(answer.status).toBe(201);
    made.push({ table: kind.table, id: answer.json.data!.id });
    return answer.json.data!;
  }

  /** `request` runs while another transaction has written `held`, and that one commits once the request waits on it. */
  async function whileHeld<T extends ApiAnswer<unknown>>(held: string, params: readonly unknown[], waitsWith: string, request: () => Promise<T>): Promise<T> {
    const holder = await mods.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(held, [...params]);
    } catch (err) {
      holder.release(err as Error);
      throw err;
    }
    const answer = request();
    try {
      await waitForBlocked(mods.pool, waitsWith);
    } catch (err) {
      // A request that never waited answered at once: its answer says why.
      await holder.query('ROLLBACK');
      holder.release();
      const early = await answer;
      throw new Error(`${(err as Error).message}; the request answered ${String(early.status)} ${JSON.stringify(early.json.error)}`);
    }
    await holder.query('COMMIT');
    holder.release();
    return answer;
  }

  async function nameOf(table: string, id: string): Promise<string> {
    const { rows } = await mods.pool.query<{ name: string }>(`SELECT name FROM "${table}" WHERE id = $1`, [id]);
    return rows[0]!.name;
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    admin = await userWithRole(mods.pool, 'admin', null);
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    for (const { table, id } of made) await mods.pool.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
    for (const id of channels) await deleteTestChannel(mods, id);
    await mods.pool.query('DELETE FROM users WHERE id = $1', [admin.id]);
    await mods.pool.end();
  });

  it.each(KINDS.filter((k) => k.table !== 'certificates').map((k) => [k.label, k] as const))(
    'answers 409 to the create that loses the race for a name: %s',
    async (_label, kind) => {
      const other = await make(kind);
      const name = fresh();

      const answer = await whileHeld(`UPDATE "${kind.table}" SET name = $1 WHERE id = $2`, [name, other.id], `insert into "${kind.table}"`,
        () => call<{ readonly id: string }>('POST', kind.path, kind.body(name)));

      if (answer.json.data) made.push({ table: kind.table, id: answer.json.data.id });
      expect(answer.status).toBe(409);
      expect(answer.json.error).toEqual({ code: 'ALREADY_EXISTS', message: `${kind.label} "${name}" already exists` });
    },
  );

  it.each(KINDS.map((k) => [k.label, k] as const))('answers 409 to the rename that loses the race for a name, and keeps the name it had: %s', async (_label, kind) => {
    const [one, other] = [await make(kind), await make(kind)];
    const before = await nameOf(kind.table, one.id);
    const name = fresh();

    const answer = await whileHeld(`UPDATE "${kind.table}" SET name = $1 WHERE id = $2`, [name, other.id], `update "${kind.table}"`,
      () => call('PUT', `${kind.path}/${one.id}`, { name, ...(kind.revised ? { revision: one.revision } : {}) }));

    expect(answer.status).toBe(409);
    expect(answer.json.error).toEqual({ code: 'ALREADY_EXISTS', message: `${kind.label} "${name}" already exists` });
    expect(await nameOf(kind.table, one.id)).toBe(before);
  });

  it('answers 409 to the tag assignment that loses the race for the same channel', async () => {
    const tag = await make(KINDS[0]!);
    const channelId = randomUUID();
    await insertTestChannel(mods, channelId);
    channels.push(channelId);

    const answer = await whileHeld('INSERT INTO channel_tag_assignments (channel_id, tag_id) VALUES ($1, $2)', [channelId, tag.id],
      'insert into "channel_tag_assignments"', () => call('POST', `/tags/${tag.id}/channels`, { channelId }));

    expect(answer.status).toBe(409);
    expect(answer.json.error).toEqual({ code: 'ALREADY_EXISTS', message: 'Tag is already assigned to this channel' });
  });
});
