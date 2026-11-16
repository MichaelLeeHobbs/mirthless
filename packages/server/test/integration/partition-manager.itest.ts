// ===========================================
// Partition Manager — real Postgres integration
// ===========================================
// Exercises the raw pg_tables existence query and the create_channel_partitions
// owner function (migration 0016) against a real database, things a mocked
// db.execute cannot validate. runtime-role.itest.ts runs the same service as
// the production server's role, which owns no tables.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  deleteTestChannel, describeIntegration, insertTestChannel, loadServerModules, unwrap, type ServerModules,
} from './_setup.js';

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

  it('createPartitions creates the channel\'s partitions, idempotently, and rows land in them', async () => {
    const { PartitionManagerService, db, sql } = mods;
    const channelId = randomUUID();
    await insertTestChannel(mods, channelId);
    try {
      unwrap(await PartitionManagerService.createPartitions(channelId));
      // Idempotent: channel import asks again for a channel that may have them.
      unwrap(await PartitionManagerService.createPartitions(channelId));
      expect(unwrap(await PartitionManagerService.partitionExists(channelId))).toBe(true);

      const inserted = await db.execute<{ part: string }>(
        sql`INSERT INTO messages (channel_id) VALUES (${channelId}) RETURNING tableoid::regclass::text AS part`,
      );
      expect(inserted.rows[0]?.part).toBe(`messages_p_${channelId.replace(/-/g, '_')}`);
    } finally {
      unwrap(await PartitionManagerService.dropPartitions(channelId));
      await deleteTestChannel(mods, channelId);
    }
  });

  it('createPartitions returns a Failure, and creates nothing, for an id with no channel', async () => {
    const { PartitionManagerService } = mods;
    const channelId = randomUUID();

    const created = await PartitionManagerService.createPartitions(channelId);

    expect(created.ok).toBe(false);
    expect(unwrap(await PartitionManagerService.partitionExists(channelId))).toBe(false);
  });

  it('createPartitions returns a Failure for an id that is not a uuid', async () => {
    const { PartitionManagerService } = mods;

    const created = await PartitionManagerService.createPartitions('x\'); DROP TABLE channels; --');

    expect(created.ok).toBe(false);
  });
});
