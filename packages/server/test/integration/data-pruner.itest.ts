// ===========================================
// Data Pruner — real Postgres integration
// ===========================================
// Exercises the pruner's real SQL against Postgres. This suite CAUGHT A REAL
// BUG that the mock-DB unit tests could not: see the "fail-safe" test below.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

const DAY_MS = 86_400_000;

describeIntegration('DataPruner (real Postgres)', () => {
  let mods: ServerModules;

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  /** Insert a message (with connector + content children) at a given age. */
  async function seedMessage(
    channelId: string,
    ageDays: number,
    state: { processed?: boolean; destinationStatus?: 'SENT' | 'QUEUED' | 'PENDING' | 'ERROR' } = {},
  ): Promise<number> {
    const { db, schema, MessageService } = mods;
    const receivedAt = new Date(Date.now() - ageDays * DAY_MS);
    const [row] = await db
      .insert(schema.messages)
      .values({ channelId, serverId: 'itest', receivedAt, processed: state.processed ?? true })
      .returning({ id: schema.messages.id });
    const messageId = row!.id;

    unwrap(await MessageService.createConnectorMessage(channelId, messageId, 0, 'source', 'SENT'));
    if (state.destinationStatus) {
      unwrap(await MessageService.createConnectorMessage(channelId, messageId, 1, 'dest', state.destinationStatus));
    }
    unwrap(await MessageService.storeContent(channelId, messageId, 0, 1, 'MSH|^~\\&|', 'HL7V2'));
    return messageId;
  }

  // This suite caught a real bug: message-delete-helper.ts bound a JS array to
  // `message_id = ANY(${ids})` with no Postgres type, so the delete failed with
  // "malformed array literal" (mock-DB unit tests never ran the real statement).
  // Fixed by casting to `ANY(${ids}::bigint[])`. This test now asserts the prune
  // actually deletes only the aged-out message and cascades to its child rows,
  // leaving the recent message (and its children) intact.
  it('pruneChannel deletes aged-out messages and their child rows in one transaction', async () => {
    const { db, schema, eq, and, DataPrunerService } = mods;
    const channelId = randomUUID();
    const oldId = await seedMessage(channelId, 40);
    const recentId = await seedMessage(channelId, 1);

    const result = await DataPrunerService.pruneChannel(channelId, 30);

    // Prune succeeded and removed exactly the aged-out message.
    expect(result.ok).toBe(true);

    const remaining = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.channelId, channelId));
    expect(remaining.map((r) => r.id)).toEqual([recentId]);

    // Child rows of the pruned message are gone (dependency-order cascade)...
    const orphanContent = await db
      .select({ messageId: schema.messageContent.messageId })
      .from(schema.messageContent)
      .where(and(eq(schema.messageContent.channelId, channelId), eq(schema.messageContent.messageId, oldId)));
    expect(orphanContent).toHaveLength(0);

    // ...while the recent message keeps its content.
    const keptContent = await db
      .select({ messageId: schema.messageContent.messageId })
      .from(schema.messageContent)
      .where(and(eq(schema.messageContent.channelId, channelId), eq(schema.messageContent.messageId, recentId)));
    expect(keptContent.length).toBeGreaterThan(0);
  });

  async function remainingIds(channelId: string): Promise<number[]> {
    const { db, schema, eq } = mods;
    const rows = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.channelId, channelId));
    return rows.map((r) => r.id).sort((a, b) => a - b);
  }

  // One bind parameter per message id hit Postgres's 65,535-parameter limit, so a
  // channel with more aged-out messages than that could never be pruned at all.
  it('prunes a channel with more aged-out messages than one statement can bind', async () => {
    const { db, sql, DataPrunerService } = mods;
    const channelId = randomUUID();
    const total = 70_000;
    await db.execute(sql`
      INSERT INTO messages (channel_id, server_id, received_at, processed)
      SELECT ${channelId}::uuid, 'itest', now() - interval '40 days', true
      FROM generate_series(1, ${total})
    `);
    const recentId = await seedMessage(channelId, 1);

    const result = await DataPrunerService.pruneChannel(channelId, 30);

    expect(result.ok ? result.value.deletedCount : result.error.message).toBe(total);
    expect(await remainingIds(channelId)).toEqual([recentId]);
  }, 120_000);

  it('keeps an aged-out message that has not finished processing', async () => {
    const { DataPrunerService } = mods;
    const channelId = randomUUID();
    const finished = await seedMessage(channelId, 40, { destinationStatus: 'SENT' });
    const errored = await seedMessage(channelId, 40, { destinationStatus: 'ERROR' });
    const unprocessed = await seedMessage(channelId, 40, { processed: false });
    const queued = await seedMessage(channelId, 40, { destinationStatus: 'QUEUED' });
    const pending = await seedMessage(channelId, 40, { destinationStatus: 'PENDING' });

    const result = unwrap(await DataPrunerService.pruneChannel(channelId, 30));

    expect(result.deletedCount).toBe(2);
    expect(await remainingIds(channelId)).toEqual([unprocessed, queued, pending].sort((a, b) => a - b));
    expect([finished, errored]).not.toEqual(expect.arrayContaining(await remainingIds(channelId)));
  });

  it('counts only messages it would actually prune in the statistics', async () => {
    const { db, schema, eq, DataPrunerService } = mods;
    const [channel] = await db
      .insert(schema.channels)
      .values({
        name: `itest-prune-${randomUUID().slice(0, 8)}`, sourceConnectorType: 'HTTP', sourceConnectorProperties: {},
        inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
        pruningEnabled: true, pruningMaxAgeDays: 30,
      } as never)
      .returning({ id: schema.channels.id });
    const channelId = channel!.id;
    await seedMessage(channelId, 40);
    await seedMessage(channelId, 40, { destinationStatus: 'QUEUED' });
    await seedMessage(channelId, 1);

    const stats = unwrap(await DataPrunerService.getStatistics());

    expect(stats.find((s) => s.channelId === channelId)?.prunableCount).toBe(1);
    const all = unwrap(await DataPrunerService.pruneAll());
    expect(all.failedChannelIds).toEqual([]);
    expect(await remainingIds(channelId)).toHaveLength(2);
    await db.delete(schema.channels).where(eq(schema.channels.id, channelId));
  });
});
