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
  async function seedMessage(channelId: string, ageDays: number): Promise<number> {
    const { db, schema, MessageService } = mods;
    const receivedAt = new Date(Date.now() - ageDays * DAY_MS);
    const [row] = await db
      .insert(schema.messages)
      .values({ channelId, serverId: 'itest', receivedAt })
      .returning({ id: schema.messages.id });
    const messageId = row!.id;

    unwrap(await MessageService.createConnectorMessage(channelId, messageId, 0, 'source', 'SENT'));
    unwrap(await MessageService.storeContent(channelId, messageId, 0, 1, 'MSH|^~\\&|', 'HL7V2'));
    return messageId;
  }

  // KNOWN BUG (release blocker) — this test documents current, broken behavior.
  // packages/server/src/services/message-delete-helper.ts builds
  //   `message_id = ANY(${ids})`
  // where `ids` is a JS array. Drizzle renders that as invalid SQL and Postgres
  // rejects it ("malformed array literal"). The mock-DB unit tests never ran the
  // real statement, so the pruner's delete has never actually worked end-to-end.
  //
  // What this test verifies (both genuinely desirable properties):
  //   1. pruneChannel FAILS LOUDLY — it surfaces the DB error as a Failure
  //      Result instead of silently succeeding (fail-safe, not silent).
  //   2. The delete runs in a transaction, so a failure deletes NOTHING —
  //      no partial data loss (critical for healthcare data integrity).
  //
  // FIX: replace `ANY(${ids})` with drizzle's `inArray(table.col, ids)` (or
  // `= ANY(${ids}::bigint[])`). Once fixed, this test will start passing the
  // prune, flip red here, and must be rewritten to assert result.ok,
  // deletedCount === 1, and the dependency-order child-row cascade.
  it('pruneChannel is fail-safe and atomic when the delete SQL errors (KNOWN BUG)', async () => {
    const { db, schema, eq, DataPrunerService } = mods;
    const channelId = randomUUID();
    const oldId = await seedMessage(channelId, 40);
    const recentId = await seedMessage(channelId, 1);

    const result = await DataPrunerService.pruneChannel(channelId, 30);

    // 1. Failure is surfaced, not swallowed.
    expect(result.ok).toBe(false);

    // 2. Transaction rolled back — nothing was deleted (no partial loss).
    const remaining = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.channelId, channelId));
    expect(remaining.map((r) => r.id).sort()).toEqual([oldId, recentId].sort());
  });
});
