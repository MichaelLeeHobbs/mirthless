// Which collection records a pruner run deletes (#417, D-390). Real SQL: row locks, batches and clocks.

import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

/** Rows of other suites may be pruned with these, so only a collection's own are asserted. */
describeIntegration('pruneExpiredRecords (real Postgres)', () => {
  const LONG = 60_000;
  let mods: ServerModules;
  let pruneExpiredRecords: typeof import('../../src/services/expired-records.js').pruneExpiredRecords;
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
    ({ pruneExpiredRecords } = await import('../../src/services/expired-records.js'));
    // What other suites left would take up room in this one's batches.
    await pruneExpiredRecords(LONG);
  });

  afterEach(async () => {
    for (const id of created.splice(0)) await mods.pool.query('DELETE FROM collections WHERE id = $1', [id]);
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function collection(defaultTtlSeconds: number | null = null): Promise<{ readonly id: string; readonly name: string }> {
    const name = `itest-prune-${randomUUID()}`;
    const { id } = unwrap(await mods.CollectionService.create({ name, description: '', indexedFields: ['k'], defaultTtlSeconds }));
    created.push(id);
    return { id, name };
  }

  /** `life`: an SQL expression for expire_at, over `n`, the number of the record. */
  async function records(collectionId: string, count: number, life: string): Promise<void> {
    await mods.pool.query(
      `INSERT INTO collection_records (collection_id, fields, payload, expire_at)
       SELECT $1, '{"k":"a"}', n::text, ${life} FROM generate_series(1, $2) AS n`,
      [collectionId, count],
    );
  }

  async function left(collectionId: string): Promise<string[]> {
    const { rows } = await mods.pool.query<{ payload: string }>('SELECT payload FROM collection_records WHERE collection_id = $1 ORDER BY payload', [collectionId]);
    return rows.map((r) => r.payload);
  }

  it('deletes the records whose life is over, and none that live on or have no life set', async () => {
    const { id, name } = await collection();
    await records(id, 3, `CASE n WHEN 1 THEN NULL WHEN 2 THEN now() + interval '1 hour' ELSE now() - interval '1 second' END`);
    // A default set later is for new records.
    unwrap(await mods.CollectionService.update(id, { defaultTtlSeconds: 1 }));

    const run = await pruneExpiredRecords(LONG);

    expect(await left(id)).toEqual(['1', '2']);
    expect(run).toMatchObject({ complete: true, failed: false });
    expect(run.byCollection[id]).toBe(1);
    expect(unwrap(await mods.CollectionService.find(name, { match: { k: 'a' }, latest: false, order: 'desc' }))).toHaveLength(2);
  });

  it('deletes a record that expired under a default the collection no longer has', async () => {
    const { id } = await collection(60);
    await records(id, 1, `now() - interval '1 second'`);
    unwrap(await mods.CollectionService.update(id, { defaultTtlSeconds: null }));

    await pruneExpiredRecords(LONG);

    expect(await left(id)).toEqual([]);
  });

  it.each([999, 1_000, 2_300])('deletes %i records in batches, and counts each', async (count) => {
    const { id } = await collection();
    await records(id, count, `now() - interval '1 hour'`);

    const run = await pruneExpiredRecords(LONG);

    expect(await left(id)).toEqual([]);
    expect(run.byCollection[id]).toBe(count);
  });

  it('counts per collection, and the total', async () => {
    const [a, b] = [await collection(), await collection()];
    await records(a.id, 2, `now() - interval '1 hour'`);
    await records(b.id, 3, `now() - interval '1 hour'`);

    const run = await pruneExpiredRecords(LONG);

    expect(run.byCollection).toMatchObject({ [a.id]: 2, [b.id]: 3 });
    expect(run.deleted).toBe(Object.values(run.byCollection).reduce((sum, n) => sum + n, 0));
  });

  it('leaves a record that is being given a new life, and deletes those behind it', async () => {
    const { id } = await collection();
    await records(id, 1_200, `now() - interval '1 hour' + n * interval '1 second'`);
    const client = await mods.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE collection_records SET expire_at = now() + interval '1 hour' WHERE collection_id = $1 AND payload = '1'`, [id]);

      const run = await pruneExpiredRecords(LONG);

      expect(run.byCollection[id]).toBe(1_199);
      await client.query('COMMIT');
    } finally {
      // Nothing to roll back once it is committed.
      await client.query('ROLLBACK');
      client.release();
    }
    await pruneExpiredRecords(LONG);
    expect(await left(id)).toEqual(['1']);
  });

  it('deletes each record once when two runs overlap', async () => {
    const { id } = await collection();
    await records(id, 3_000, `now() - interval '1 hour'`);

    const runs = await Promise.all([pruneExpiredRecords(LONG), pruneExpiredRecords(LONG)]);

    expect(runs.map((run) => run.failed)).toEqual([false, false]);
    expect(await left(id)).toEqual([]);
    expect((runs[0].byCollection[id] ?? 0) + (runs[1].byCollection[id] ?? 0)).toBe(3_000);
  });

  it('stops after the batch in which its time was up, and the next run goes on', async () => {
    const { id } = await collection();
    await records(id, 1_500, `now() - interval '1 hour'`);

    const first = await pruneExpiredRecords(0);

    expect(first).toMatchObject({ deleted: 1_000, complete: false, failed: false });
    expect(await left(id)).toHaveLength(500);
    expect((await pruneExpiredRecords(LONG)).byCollection[id]).toBe(500);
  });

  it('says how many it deleted when a later batch fails, and that it failed', async () => {
    const { id } = await collection();
    await records(id, 1_500, `now() - interval '1 hour' + n * interval '1 second'`);
    await mods.pool.query(`CREATE FUNCTION itest_refuse_1400() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.payload = '1400' THEN RAISE EXCEPTION 'refused'; END IF; RETURN OLD; END $$`);
    await mods.pool.query('CREATE TRIGGER itest_refuse_1400 BEFORE DELETE ON collection_records FOR EACH ROW EXECUTE FUNCTION itest_refuse_1400()');
    try {
      const run = await pruneExpiredRecords(LONG);

      expect(run).toMatchObject({ complete: false, failed: true });
      expect(run.byCollection[id]).toBe(1_000);
      expect(await left(id)).toHaveLength(500);
    } finally {
      await mods.pool.query('DROP TRIGGER itest_refuse_1400 ON collection_records');
      await mods.pool.query('DROP FUNCTION itest_refuse_1400()');
    }
  });

  it('is run by the data pruner, which records it', async () => {
    const { id } = await collection();
    await records(id, 4, `now() - interval '1 hour'`);

    const run = unwrap(await mods.DataPrunerService.pruneAll());

    expect(run.expiredRecordsDeleted).toBeGreaterThanOrEqual(4);
    expect(run).toMatchObject({ expiredRecordsComplete: true, expiredRecordsFailed: false });
    await expect.poll(async () => {
      const { rows } = await mods.pool.query<{ n: string | null }>(
        `SELECT attributes->'expiredRecordsByCollection'->>$1 AS n FROM events WHERE name = 'DATA_PRUNER_RAN' ORDER BY id DESC LIMIT 1`, [id],
      );
      return rows[0]?.n;
    }).toBe('4');
  });

  it.each([
    ['the server is a year ahead', 1, `now() + interval '1 hour'`],
    ['the database is, for which the server is behind it', -1, `now() - interval '1 hour'`],
  ])('deletes nothing that only one clock calls expired: %s', async (_whose, years, life) => {
    const { id } = await collection();
    await records(id, 1, life);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + years * 365 * 86_400_000 });
    try {
      await pruneExpiredRecords(LONG);
    } finally {
      vi.useRealTimers();
    }

    expect(await left(id)).toEqual(['1']);
  });
});
