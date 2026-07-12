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
});
