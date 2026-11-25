// What the pruner does with rows of messages that are no longer there (#403, D-371). It deletes stored
// content for good, so most of this is about what it must not touch.

import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { deleteTestChannel, describeIntegration, insertTestChannel, loadServerModules, unwrap, WAIT, type ServerModules } from './_setup.js';

describeIntegration('Rows that deleted messages left behind (real Postgres)', () => {
  const TABLES = ['connector_messages', 'message_content', 'message_custom_metadata', 'message_attachments'] as const;
  let mods: ServerModules;
  let sweep: typeof import('../../src/services/leftover-rows.js').sweepLeftoverRows;
  let channelId: string;

  beforeAll(async () => {
    mods = await loadServerModules();
    ({ sweepLeftoverRows: sweep } = await import('../../src/services/leftover-rows.js'));
  });

  beforeEach(async () => {
    channelId = randomUUID();
    await insertTestChannel(mods, channelId);
    unwrap(await mods.PartitionManagerService.createPartitions(channelId));
    // What other suites received today would put every id here above the age limit.
    await mods.pool.query(`UPDATE messages SET received_at = now() - interval '2 days' WHERE received_at > now() - interval '2 days'`);
    // Nor do those they left behind count here.
    await sweep(AMPLE_MS);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    unwrap(await mods.PartitionManagerService.dropPartitions(channelId));
    await deleteTestChannel(mods, channelId);
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function message(): Promise<number> {
    const { MessageService } = mods;
    const { messageId } = unwrap(await MessageService.createMessage(channelId, 'itest'));
    await mods.pool.query(`UPDATE messages SET received_at = now() - interval '2 days' WHERE channel_id = $1 AND id = $2`, [channelId, messageId]);
    unwrap(await MessageService.createConnectorMessage(channelId, messageId, 0, 'Source', 'SENT'));
    unwrap(await MessageService.createConnectorMessage(channelId, messageId, 1, 'Partner', 'SENT'));
    unwrap(await MessageService.storeContent(channelId, messageId, 0, CONTENT_TYPE.RAW, 'PHI', 'RAW'));
    unwrap(await MessageService.storeContent(channelId, messageId, 1, CONTENT_TYPE.RESPONSE, 'PHI', 'RAW'));
    unwrap(await MessageService.storeCustomMetadata(channelId, messageId, 0, { mrn: '1' }));
    unwrap(await MessageService.storeAttachment(channelId, messageId, randomUUID(), 'text/plain', 'PHI', 3));
    return messageId;
  }

  /** As a delete left one behind that was still being processed. */
  async function leftover(destination = 'SENT'): Promise<number> {
    const messageId = await message();
    await mods.pool.query('DELETE FROM messages WHERE channel_id = $1 AND id = $2', [channelId, messageId]);
    await mods.pool.query('UPDATE connector_messages SET status = $3 WHERE channel_id = $1 AND message_id = $2 AND meta_data_id = 1', [channelId, messageId, destination]);
    return messageId;
  }

  async function rowsOf(messageId: number): Promise<number[]> {
    const counts: number[] = [];
    for (const table of TABLES) {
      const { rows } = await mods.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE channel_id = $1 AND message_id = $2`, [channelId, messageId]);
      counts.push(rows[0]!.n);
    }
    return counts;
  }

  /** A busy host must not end a run early. */
  const AMPLE_MS = 3_600_000;
  const ALL = [2, 2, 1, 1];
  const NONE = [0, 0, 0, 0];

  it('deletes them from every table, and nothing of a message that is there', async () => {
    const before = await message();
    const gone = await leftover();
    const open = await message();
    const alsoGone = await leftover();
    const after = await message();
    await mods.pool.query('UPDATE messages SET processed = false WHERE channel_id = $1 AND id = $2', [channelId, open]);

    expect(await sweep(AMPLE_MS)).toEqual({ rowsDeleted: 12, complete: true, failed: false });

    expect([await rowsOf(gone), await rowsOf(alsoGone)]).toEqual([NONE, NONE]);
    expect([await rowsOf(before), await rowsOf(open), await rowsOf(after)]).toEqual([ALL, ALL, ALL]);
    expect(await sweep(AMPLE_MS)).toEqual({ rowsDeleted: 0, complete: true, failed: false });
  });

  it('deletes content that has nothing else left', async () => {
    const gone = await leftover();
    await message();
    for (const table of ['connector_messages', 'message_custom_metadata', 'message_attachments']) {
      await mods.pool.query(`DELETE FROM ${table} WHERE channel_id = $1 AND message_id = $2`, [channelId, gone]);
    }

    expect((await sweep(AMPLE_MS)).rowsDeleted).toBe(2);
    expect(await rowsOf(gone)).toEqual(NONE);
  });

  it('keeps those as young as the oldest message of the last day, and younger', async () => {
    const old = await leftover();
    const recent = await message();
    const young = await leftover();
    await message();
    await mods.pool.query('UPDATE messages SET received_at = now() WHERE channel_id = $1 AND id = $2', [channelId, recent]);

    await sweep(AMPLE_MS);

    expect([await rowsOf(old), await rowsOf(young)]).toEqual([NONE, ALL]);
  });

  it('keeps those younger than every message there is', async () => {
    const youngest = await leftover();

    await sweep(AMPLE_MS);

    expect(await rowsOf(youngest)).toEqual(ALL);
    await message();
    await sweep(AMPLE_MS);
    expect(await rowsOf(youngest)).toEqual(NONE);
  });

  it.each(['QUEUED', 'PENDING'])('keeps one whose destination is %s, which its queue would deliver, until that has ended', async (status) => {
    const queued = await leftover(status);
    await message();

    await sweep(AMPLE_MS);
    expect(await rowsOf(queued)).toEqual(ALL);

    await mods.pool.query(`UPDATE connector_messages SET status = 'SENT' WHERE channel_id = $1`, [channelId]);
    await sweep(AMPLE_MS);
    expect(await rowsOf(queued)).toEqual(NONE);
  });

  it('deletes those of a deleted channel', async () => {
    const gone = await leftover();
    await message();
    await mods.pool.query('UPDATE channels SET deleted_at = now() WHERE id = $1', [channelId]);

    await sweep(AMPLE_MS);

    expect(await rowsOf(gone)).toEqual(NONE);
  });

  it('finds them among more rows than it reads at once, and goes on where it stopped when its time is up', async () => {
    const first = await leftover();
    const kept = await message();
    // Pages end in the middle of its rows.
    await mods.pool.query(
      `INSERT INTO message_content (channel_id, message_id, meta_data_id, content_type, content) SELECT $1, $2, n, 1, 'PHI' FROM generate_series(2, 5200) n`, [channelId, kept]);
    const second = await leftover();
    await message();
    for (const table of ['message_attachments', 'message_custom_metadata']) {
      await mods.pool.query(`DELETE FROM ${table} WHERE channel_id = $1 AND message_id IN ($2, $3)`, [channelId, first, second]);
    }
    const execute = mods.db.execute.bind(mods.db);
    const now = Date.now.bind(Date);
    let late = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + late);
    vi.spyOn(mods.db, 'execute').mockImplementation(((query: Parameters<typeof execute>[0]) => execute(query).then((result) => {
      if (result.command === 'DELETE' && result.rowCount === 2) late = 100 * AMPLE_MS;
      return result;
    })) as unknown as typeof execute);

    expect(await sweep(AMPLE_MS)).toEqual({ rowsDeleted: 2, complete: false, failed: false });
    expect([await rowsOf(first), await rowsOf(second)]).toEqual([[2, 0, 0, 0], [2, 2, 0, 0]]);
    vi.restoreAllMocks();

    expect(await sweep(AMPLE_MS)).toEqual({ rowsDeleted: 6, complete: true, failed: false });
    expect([await rowsOf(first), await rowsOf(second)]).toEqual([NONE, NONE]);
    expect((await rowsOf(kept))[1]).toBe(2 + 5_199);
  });

  it('has no time left: nothing is read, and the next run deletes them', async () => {
    const gone = await leftover();
    await message();

    expect(await sweep(0)).toEqual({ rowsDeleted: 0, complete: false, failed: false });
    expect(await rowsOf(gone)).toEqual(ALL);
    expect((await sweep(AMPLE_MS)).rowsDeleted).toBe(6);
  });

  it('a table it could not read leaves the run failed, and it and those that go on from it incomplete', async () => {
    const gone = await leftover();
    await message();
    const execute = mods.db.execute.bind(mods.db);
    const now = Date.now.bind(Date);
    let late = 0;
    let calls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + late);
    // The read of the first table fails, and the time is up after it.
    vi.spyOn(mods.db, 'execute').mockImplementation(((query: Parameters<typeof execute>[0]) => {
      calls += 1;
      if (calls !== 2) return execute(query);
      late = 100 * AMPLE_MS;
      return Promise.reject(new Error('no more locks'));
    }) as unknown as typeof execute);

    expect(await sweep(AMPLE_MS)).toEqual({ rowsDeleted: 0, complete: false, failed: true });
    vi.restoreAllMocks();

    expect(await sweep(AMPLE_MS)).toMatchObject({ complete: false, failed: false });
    expect(await sweep(AMPLE_MS)).toMatchObject({ complete: true, failed: false });
    expect(await rowsOf(gone)).toEqual(NONE);
  });

  it('a run beside another does nothing', async () => {
    await leftover();
    await message();

    const results = await Promise.all([sweep(AMPLE_MS), sweep(AMPLE_MS)]);

    expect(results.map((r) => [r.rowsDeleted, r.complete])).toEqual([[6, true], [0, false]]);
  });

  it('is part of a pruner run, which records how many rows there were', async () => {
    const gone = await leftover();
    await message();

    const pruned = unwrap(await mods.DataPrunerService.pruneAll());

    expect(pruned).toMatchObject({ leftoverRowsDeleted: 6, leftoverRowsComplete: true });
    expect(await rowsOf(gone)).toEqual(NONE);
    await vi.waitFor(async () => {
      const { rows } = await mods.pool.query<{ attributes: unknown }>(`SELECT attributes FROM events WHERE name = 'DATA_PRUNER_RAN' ORDER BY id DESC LIMIT 1`);
      expect(rows[0]!.attributes).toMatchObject({ leftoverRowsDeleted: 6, leftoverRowsComplete: true });
    }, WAIT);
  });

  it('every table it reads has an index that starts with the channel and the message', async () => {
    for (const table of TABLES) {
      const { rows } = await mods.pool.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename = $1`, [table]);
      expect(rows.some(({ indexdef }) => indexdef.includes('(channel_id, message_id')), table).toBe(true);
    }
  });
});
