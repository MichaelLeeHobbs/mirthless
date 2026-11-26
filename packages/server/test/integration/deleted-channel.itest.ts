// Deleted channels keep their messages: listed for an administrator, and removed at one's word (#202, D-389).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { inTurn } from '../../src/lib/channel-turns.js';
import { migratedFrom } from './_migration-db.js';
import {
  apiCall, closeServer, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, listen, loadServerModules, unwrap, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

const TABLES = ['messages', 'connector_messages', 'message_content', 'message_attachments', 'message_custom_metadata'] as const;
const DAY_MS = 86_400_000;

type Listed = { readonly channelId: string; readonly name: string; readonly messages: number; readonly undelivered: number };

describeIntegration('the messages of deleted channels (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let admin: TestUser;
  let getEngine: typeof import('../../src/engine.js').getEngine;
  let AuditService: typeof import('../../src/services/audit.service.js').AuditService;
  const made: string[] = [];

  const call = <T>(method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, admin.token, method, `/admin/prune${path}`, body);
  const purge = (id: string, body: unknown = { reason: 'the partner asked for it' }): Promise<ApiAnswer<{ messages: number; undelivered: number }>> => call('POST', `/deleted-channels/${id}`, body);

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    ({ getEngine } = await import('../../src/engine.js'));
    ({ AuditService } = await import('../../src/services/audit.service.js'));
    admin = await userWithRole(mods.pool, 'admin', null);
    ({ server, base } = await listen((await import('../../src/app.js')).default));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of made.splice(0)) {
      for (const table of TABLES) await mods.pool.query(`DELETE FROM ${table} WHERE channel_id = $1`, [id]);
      unwrap(await mods.PartitionManagerService.dropPartitions(id));
      await deleteTestChannel(mods, id);
    }
  });

  afterAll(async () => {
    await closeServer(server);
    if (admin) await mods.pool.query('DELETE FROM users WHERE id = $1', [admin.id]);
    await mods?.pool.end();
  });

  async function channel(options: { readonly partitions?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    made.push(id);
    await insertTestChannel(mods, id);
    if (options.partitions !== false) unwrap(await mods.PartitionManagerService.createPartitions(id));
    return id;
  }

  interface Seed { readonly ageDays?: number; readonly processed?: boolean; readonly destination?: 'SENT' | 'QUEUED' | 'PENDING' }

  /** With a row in every table of a message. */
  async function message(id: string, { ageDays = 0, processed = true, destination = 'SENT' }: Seed = {}): Promise<number> {
    const { rows } = await mods.pool.query<{ id: string }>(
      'INSERT INTO messages (channel_id, server_id, received_at, processed) VALUES ($1, $2, $3, $4) RETURNING id',
      [id, 'itest', new Date(Date.now() - ageDays * DAY_MS), processed],
    );
    const messageId = Number(rows[0]!.id);
    unwrap(await mods.MessageService.createConnectorMessage(id, messageId, 0, 'source', 'SENT'));
    unwrap(await mods.MessageService.createConnectorMessage(id, messageId, 1, 'dest', destination));
    unwrap(await mods.MessageService.storeContent(id, messageId, 0, 1, 'MSH|^~\\&|', 'HL7V2'));
    await mods.pool.query(`INSERT INTO message_attachments (id, channel_id, message_id, attachment_size, content) VALUES ($1, $2, $3, 1, 'x')`, [randomUUID(), id, messageId]);
    await mods.pool.query(`INSERT INTO message_custom_metadata (channel_id, message_id, meta_data_id, metadata) VALUES ($1, $2, 0, '{"mrn":"1"}')`, [id, messageId]);
    return messageId;
  }

  /** Rows of the channel in each table of messages. */
  async function rowsOf(id: string): Promise<number[]> {
    const counted = await Promise.all(TABLES.map((table) => mods.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE channel_id = $1`, [id])));
    return counted.map(({ rows }) => rows[0]!.n);
  }

  const del = async (id: string): Promise<void> => { unwrap(await mods.ChannelService.delete(id)); };

  describe('the list', () => {
    it('is of the deleted channels that have messages, with how many, from when to when, and whether they are pruned', async () => {
      const [live, empty, kept, pruned, noAge] = [await channel(), await channel(), await channel(), await channel(), await channel()];
      for (const id of [live, kept, pruned, noAge]) await message(id, { ageDays: 1 });
      await message(kept, { ageDays: 9 });
      await message(kept, { ageDays: 3, processed: false });
      await message(kept, { ageDays: 4, destination: 'QUEUED' });
      await message(kept, { ageDays: 5, processed: false, destination: 'PENDING' });
      // Taken from its queue for a send that a stop or a crash cut short.
      await message(kept, { ageDays: 6, destination: 'PENDING' });
      await mods.pool.query('UPDATE channels SET pruning_enabled = true, pruning_max_age_days = 12 WHERE id = $1', [pruned]);
      await mods.pool.query('UPDATE channels SET pruning_enabled = true WHERE id = $1', [noAge]);
      for (const id of [empty, kept, pruned, noAge]) await del(id);

      const answer = await call<Array<Listed & { deletedAt: string; firstReceivedAt: string; lastReceivedAt: string; prunedAfterDays: number | null }>>('GET', '/deleted-channels');

      expect(answer.status).toBe(200);
      const listed = new Map(answer.json.data!.map((c) => [c.channelId, c]));
      expect([live, empty].map((id) => listed.has(id))).toEqual([false, false]);
      expect([kept, pruned, noAge].map((id) => [listed.get(id)?.messages, listed.get(id)?.undelivered, listed.get(id)?.prunedAfterDays])).toEqual([[6, 4, null], [1, 0, 12], [1, 0, 30]]);
      const { name, deletedAt, firstReceivedAt, lastReceivedAt } = listed.get(kept)!;
      expect(name).toBe(`itest-${kept}`);
      expect(Math.abs(Date.parse(deletedAt) - Date.now())).toBeLessThan(DAY_MS / 24);
      expect(Math.round((Date.parse(lastReceivedAt) - Date.parse(firstReceivedAt)) / DAY_MS)).toBe(8);
    });

    it.each(TABLES.slice(1))('has a channel of which only rows of %s are left, which an earlier delete left behind', async (table) => {
      const id = await channel();
      await message(id, { destination: 'QUEUED' });
      for (const other of TABLES.filter((t) => t !== table)) await mods.pool.query(`DELETE FROM ${other} WHERE channel_id = $1`, [id]);
      await del(id);

      const answer = await call<Listed[]>('GET', '/deleted-channels');

      expect(answer.json.data!.find((c) => c.channelId === id)).toMatchObject({ messages: 0, undelivered: 0, firstReceivedAt: null, lastReceivedAt: null });
    });

    it('is of the channels in the reader\'s access only', async () => {
      const [inside, outside] = [await channel(), await channel()];
      for (const id of [inside, outside]) await message(id);
      const group = await insertTestGroup(mods.pool);
      await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [group, inside]);
      const reader = await userWithRole(mods.pool, 'admin', [group]);
      try {
        for (const id of [inside, outside]) await del(id);

        const answer = await apiCall<Listed[]>(base, reader.token, 'GET', '/admin/prune/deleted-channels');

        expect(answer.status).toBe(200);
        expect([inside, outside].map((id) => answer.json.data!.some((c) => c.channelId === id))).toEqual([true, false]);
      } finally {
        await mods.pool.query('DELETE FROM users WHERE id = $1', [reader.id]);
        await mods.pool.query('DELETE FROM channel_group_members WHERE channel_group_id = $1', [group]);
        await mods.pool.query('DELETE FROM channel_groups WHERE id = $1', [group]);
      }
    });
  });

  it('are still found in the message browser, which says that the channel is deleted', async () => {
    const [live, deleted] = [await channel(), await channel()];
    for (const id of [live, deleted]) await message(id);
    await del(deleted);
    const search = async (id: string): Promise<unknown> => {
      const { status, json } = await apiCall<{ total: number; channelDeleted: boolean }>(base, admin.token, 'GET', `/channels/${id}/messages`);
      return [status, json.data?.total, json.data?.channelDeleted];
    };

    expect([await search(live), await search(deleted)]).toEqual([[200, 1, false], [200, 1, true]]);
    await mods.pool.query('DELETE FROM messages WHERE channel_id = $1', [deleted]);
    expect(await search(deleted)).toEqual([200, 0, true]);
  });

  describe('the removal of all messages', () => {
    it.each([['with', true], ['without', false]])('empties every table of messages of that channel, and of no other, %s partitions', async (_how, partitions) => {
      const [deleted, alsoDeleted, live] = [await channel({ partitions }), await channel({ partitions }), await channel({ partitions })];
      for (const id of [deleted, alsoDeleted, live]) {
        await message(id);
        await message(id, { processed: false });
        await message(id, { destination: 'QUEUED' });
      }
      const leftBehind = await message(deleted, { destination: 'QUEUED' });
      await mods.pool.query('DELETE FROM messages WHERE channel_id = $1 AND id = $2', [deleted, leftBehind]);
      for (const id of [deleted, alsoDeleted]) await del(id);

      const answer = await purge(deleted);

      // The row left behind is of no message, so it is not counted as one that was never delivered.
      expect([answer.status, answer.json.data]).toEqual([200, { messages: 3, undelivered: 2 }]);
      expect(await rowsOf(deleted)).toEqual([0, 0, 0, 0, 0]);
      for (const id of [alsoDeleted, live]) expect(await rowsOf(id)).toEqual([3, 6, 3, 3, 3]);
      const listed = (await call<Listed[]>('GET', '/deleted-channels')).json.data!.map((c) => c.channelId);
      expect([listed.includes(deleted), listed.includes(alsoDeleted)]).toEqual([false, true]);
    });

    it('is recorded in the audit log, with what was removed and why', async () => {
      const id = await channel();
      await message(id);
      await message(id, { destination: 'QUEUED' });
      await del(id);

      await purge(id, { reason: '  moved to the new engine ' });

      const { rows } = await mods.pool.query<Record<string, unknown>>(
        `SELECT user_id, outcome, attributes - 'deletedAt' AS attributes FROM audit_log WHERE action = 'MESSAGES_PURGED' AND channel_id = $1`, [id]);
      expect(rows).toEqual([{
        user_id: admin.id, outcome: 'SUCCESS',
        attributes: { channelName: `itest-${id}`, messages: 2, undelivered: 1, reason: 'moved to the new engine' },
      }]);
    });

    it('does not happen when it cannot be recorded', async () => {
      const id = await channel();
      await message(id);
      await del(id);
      vi.spyOn(AuditService, 'recordInTx').mockRejectedValue(new Error('no space left'));

      const answer = await purge(id);

      expect([answer.status, answer.json.error?.code]).toEqual([503, 'AUDIT_UNAVAILABLE']);
      expect(await rowsOf(id)).toEqual([1, 2, 1, 1, 1]);
    });

    it.each([
      ['a channel that is not deleted', 409, 'CONFLICT', async (): Promise<string> => channel()],
      ['a channel that does not exist', 404, 'NOT_FOUND', async (): Promise<string> => randomUUID()],
    ])('is refused for %s', async (_what, status, code, makeId) => {
      const id = await makeId();
      if (status === 409) await message(id);

      const answer = await purge(id);

      expect([answer.status, answer.json.error?.code]).toEqual([status, code]);
      if (status === 409) expect(await rowsOf(id)).toEqual([1, 2, 1, 1, 1]);
    });

    it.each([
      ['a runtime', (engine: ReturnType<typeof getEngine>) => { vi.spyOn(engine, 'getRuntime').mockReturnValue({} as never); }],
      ['work on its messages', (engine: ReturnType<typeof getEngine>) => { vi.spyOn(engine, 'isAtRest').mockReturnValue(false); }],
    ])('is refused while the channel has %s', async (_what, fake) => {
      const id = await channel();
      await message(id);
      await del(id);
      fake(getEngine());

      const answer = await purge(id);

      expect([answer.status, answer.json.error?.code]).toEqual([409, 'CONFLICT']);
      expect(await rowsOf(id)).toEqual([1, 2, 1, 1, 1]);
    });

    it('waits for what is under way on the channel', async () => {
      const id = await channel();
      await message(id);
      await del(id);
      let done: () => void = () => undefined;
      const deploy = inTurn(id, () => new Promise<void>((resolve) => { done = resolve; }));
      let answered = false;
      const purging = purge(id).then((answer) => { answered = true; return answer; });
      const atRest = vi.spyOn(getEngine(), 'isAtRest');
      // What is asked of the channel behind the deploy comes after it.
      const order: string[] = [];
      atRest.mockImplementation(() => { order.push('asked'); return true; });
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      expect([answered, order]).toEqual([false, []]);

      order.push('deployed');
      done();
      await deploy;

      expect((await purging).status).toBe(200);
      expect(order).toEqual(['deployed', 'asked']);
      expect((await rowsOf(id))[0]).toBe(0);
    });

    it('is refused while the messages are being read or backed up, and can be had afterwards', async () => {
      const id = await channel();
      await message(id);
      await del(id);
      const reader = await mods.pool.connect();
      try {
        await reader.query('BEGIN');
        await reader.query('SELECT 1 FROM message_content WHERE channel_id = $1', [id]);

        const started = Date.now();
        const refused = await purge(id);
        // It tries for 5 seconds, and the last wait can end a second after that.
        expect(Date.now() - started).toBeGreaterThan(4_500);
        expect(Date.now() - started).toBeLessThan(9_000);
        expect([refused.status, refused.json.error?.code]).toEqual([409, 'CONFLICT']);
        expect(refused.json.error?.message).toContain('Nothing was removed');
        expect(await rowsOf(id)).toEqual([1, 2, 1, 1, 1]);
      } finally {
        await reader.query('ROLLBACK');
        reader.release();
      }
      expect((await purge(id)).status).toBe(200);
      expect(await rowsOf(id)).toEqual([0, 0, 0, 0, 0]);
    });

    // The Traffic search takes connector_messages before messages; a purge that held messages and waited would deadlock with it.
    it('neither deadlocks with a read that takes the tables in another order, nor holds it up', async () => {
      const id = await channel();
      await message(id);
      await del(id);
      const reader = await mods.pool.connect();
      try {
        await reader.query('BEGIN');
        await reader.query('SELECT count(*) FROM connector_messages WHERE channel_id = $1', [id]);
        const purging = purge(id);
        await new Promise((resolve) => { setTimeout(resolve, 300); });

        const started = Date.now();
        await reader.query('SELECT count(*) FROM messages WHERE channel_id = $1', [id]);
        expect(Date.now() - started).toBeLessThan(500);
        await reader.query('COMMIT');

        expect((await purging).status).toBe(200);
        expect(await rowsOf(id)).toEqual([0, 0, 0, 0, 0]);
      } finally {
        await reader.query('ROLLBACK').catch(() => undefined);
        reader.release();
      }
    });

    // Postgres cancels an autovacuum only for a lock that has waited behind it for deadlock_timeout.
    it('waits for a partition held until someone waits for it, as an autovacuum holds one, and holds nothing else meanwhile', async () => {
      const id = await channel();
      await message(id);
      await del(id);
      const suffix = `_p_${id.replaceAll('-', '_')}`;
      const waiting = async (): Promise<number> => (await mods.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks WHERE relation = $1::regclass AND mode = 'AccessExclusiveLock' AND NOT granted`, [`connector_messages${suffix}`])).rows[0]!.n;
      const holder = await mods.pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`LOCK TABLE connector_messages${suffix} IN SHARE UPDATE EXCLUSIVE MODE`);
        const purging = purge(id);
        await expect.poll(waiting).toBe(1);

        const { rows } = await mods.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname LIKE '%' || $1 AND l.mode = 'AccessExclusiveLock' AND l.granted`, [suffix]);
        expect(rows[0]!.n).toBe(0);
        // Creating a channel locks the parent tables; a purge that held them would hold it up, and every insert behind it.
        const started = Date.now();
        await channel();
        expect(Date.now() - started).toBeLessThan(1_000);
        // A read of that partition waits behind the purge's request only until that wait ends.
        const reading = Date.now();
        await mods.pool.query('SELECT count(*) FROM connector_messages WHERE channel_id = $1', [id]);
        expect(Date.now() - reading).toBeLessThan(2_000);
        await holder.query('COMMIT');

        expect((await purging).status).toBe(200);
        expect(await rowsOf(id)).toEqual([0, 0, 0, 0, 0]);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
    });

    it.each([[undefined], [{}], [{ reason: '' }], [{ reason: ' a ' }], [{ reason: 'one\nline' }], [{ reason: 'x'.repeat(501) }]])('needs a reason: %j', async (body) => {
      const id = await channel();
      await message(id);
      await del(id);

      expect((await purge(id, body ?? null)).status).toBe(400);
      expect((await rowsOf(id))[0]).toBe(1);
    });
  });

  it('leaves the messages of channels deleted before the upgrade to an administrator', async () => {
    const ids = { live: randomUUID(), deleted: randomUUID(), off: randomUUID() };
    const db = await migratedFrom(28, async (client) => {
      for (const [name, id] of Object.entries(ids)) {
        await client.query(
          `INSERT INTO channels (id, name, inbound_data_type, outbound_data_type, source_connector_type, source_connector_properties, pruning_enabled, pruning_max_age_days, deleted_at)
           VALUES ($1, $2, 'RAW', 'RAW', 'CHANNEL', '{}', $3, 7, $4)`, [id, name, name !== 'off', name === 'live' ? null : new Date()]);
      }
    });
    try {
      const { rows } = await db.client.query<{ name: string; pruning_enabled: boolean; pruning_max_age_days: number }>(
        'SELECT name, pruning_enabled, pruning_max_age_days FROM channels WHERE id = ANY($1::uuid[]) ORDER BY name', [Object.values(ids)]);
      expect(rows.map((r) => [r.name, r.pruning_enabled, r.pruning_max_age_days])).toEqual([['deleted', false, 7], ['live', true, 7], ['off', false, 7]]);
    } finally {
      await db.drop();
    }
  });
});
