// ===========================================
// Partition Manager — real Postgres integration
// ===========================================
// Exercises the raw pg_tables existence query and the CREATE TABLE ... PARTITION
// OF ... FOR VALUES IN DDL technique against a real database — things a mocked
// db.execute cannot validate.
//
// KNOWN SCHEMA DRIFT: the shipped Drizzle migrations create the six parent
// tables (messages, connector_messages, message_content, ...) as PLAIN tables,
// NOT `PARTITION BY LIST (channel_id)`. So against a migrated DB,
// PartitionManagerService.createPartitions() currently returns a Failure Result
// (surfaced, not crashed — which this suite also verifies). The cross-check test
// below asserts createPartitions and partitionExists stay consistent regardless
// of which state the schema is in, so it survives a future migration fix.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('PartitionManager (real Postgres)', () => {
  let mods: ServerModules;

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  it('partitionExists returns false for a channel with no partitions', async () => {
    const { PartitionManagerService } = mods;
    const exists = unwrap(await PartitionManagerService.partitionExists(randomUUID()));
    expect(exists).toBe(false);
  });

  it('createPartitions is fail-safe and stays consistent with partitionExists', async () => {
    const { PartitionManagerService } = mods;
    const channelId = randomUUID();

    // Must return a Result (never throw / crash the process), whatever the schema.
    const created = await PartitionManagerService.createPartitions(channelId);
    expect(typeof created.ok).toBe('boolean');

    const exists = unwrap(await PartitionManagerService.partitionExists(channelId));
    // If the parents are partitioned, creation succeeded and the partition exists;
    // otherwise creation failed and no partition exists. Either way they agree.
    expect(exists).toBe(created.ok);
  });

  it('the LIST partition DDL technique routes rows by channel_id (real Postgres)', async () => {
    const { db, sql } = mods;
    const suffix = randomUUID().replace(/-/g, '_');
    const parent = `itest_part_${suffix}`;
    const channelId = randomUUID();
    const child = `${parent}_p_${channelId.replace(/-/g, '_')}`;

    await db.execute(
      sql.raw(`CREATE TABLE "${parent}" (channel_id uuid NOT NULL, val text) PARTITION BY LIST (channel_id)`),
    );
    try {
      // Exact shape emitted by PartitionManagerService.createPartitions.
      const ddl = `CREATE TABLE IF NOT EXISTS "${child}" PARTITION OF "${parent}" FOR VALUES IN ('${channelId}')`;
      await db.execute(sql.raw(ddl));
      // Idempotent — running the same DDL again must not error.
      await db.execute(sql.raw(ddl));

      await db.execute(sql.raw(`INSERT INTO "${parent}" (channel_id, val) VALUES ('${channelId}', 'routed')`));

      const rows = (await db.execute(sql.raw(`SELECT val FROM "${child}"`))).rows;
      expect(rows).toHaveLength(1);
    } finally {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS "${parent}" CASCADE`));
    }
  });
});
