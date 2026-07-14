// ===========================================
// Cross-Channel Search — real Postgres integration
// ===========================================
// Proves the triage feed surfaces DESTINATION send failures (not just source
// errors) and displays the errored connector — the metaDataId=0 blind-spot fix.
// Also exercises the status / channelIds where-clause branches that the old
// mock-the-ORM unit test never touched.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('CrossChannelSearchService (real Postgres)', () => {
  let mods: ServerModules;
  const channelIds: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterEach(async () => {
    const { db, schema, eq } = mods;
    for (const id of channelIds.splice(0)) {
      await db.delete(schema.messages).where(eq(schema.messages.channelId, id));
    }
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  /** Insert a message with the given per-connector statuses. metaDataId 0 = source. */
  async function seedMessage(
    channelId: string,
    connectors: ReadonlyArray<{ metaDataId: number; name: string; status: string }>,
  ): Promise<number> {
    const { db, schema, MessageService } = mods;
    const [row] = await db
      .insert(schema.messages)
      .values({ channelId, serverId: 'itest' })
      .returning({ id: schema.messages.id });
    const messageId = row!.id;
    for (const c of connectors) {
      unwrap(await MessageService.createConnectorMessage(channelId, messageId, c.metaDataId, c.name, c.status));
    }
    return messageId;
  }

  it('surfaces a DESTINATION-only error and displays the errored connector', async () => {
    const channelId = randomUUID();
    channelIds.push(channelId);
    // Source succeeded, destination failed — the dominant healthcare failure mode.
    const failedId = await seedMessage(channelId, [
      { metaDataId: 0, name: 'TCP Listener', status: 'SENT' },
      { metaDataId: 1, name: 'HTTP Writer', status: 'ERROR' },
    ]);
    // A fully-successful message must NOT appear in the ERROR triage.
    await seedMessage(channelId, [
      { metaDataId: 0, name: 'TCP Listener', status: 'SENT' },
      { metaDataId: 1, name: 'HTTP Writer', status: 'SENT' },
    ]);

    const result = unwrap(await mods.CrossChannelSearchService.search({
      status: 'ERROR', channelIds: channelId, limit: 50, offset: 0,
    }));

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.messageId).toBe(failedId);
    // Displayed status/connector reflect the errored DESTINATION, not the source.
    expect(result.items[0]!.status).toBe('ERROR');
    expect(result.items[0]!.connectorName).toBe('HTTP Writer');
  });

  it('does not list a message whose only errors are on a different status filter', async () => {
    const channelId = randomUUID();
    channelIds.push(channelId);
    await seedMessage(channelId, [
      { metaDataId: 0, name: 'TCP Listener', status: 'SENT' },
      { metaDataId: 1, name: 'HTTP Writer', status: 'QUEUED' },
    ]);

    const errored = unwrap(await mods.CrossChannelSearchService.search({
      status: 'ERROR', channelIds: channelId, limit: 50, offset: 0,
    }));
    expect(errored.total).toBe(0);

    const queued = unwrap(await mods.CrossChannelSearchService.search({
      status: 'QUEUED', channelIds: channelId, limit: 50, offset: 0,
    }));
    expect(queued.total).toBe(1);
    expect(queued.items[0]!.status).toBe('QUEUED');
  });

  it('filters by channelIds (only the requested channel is returned)', async () => {
    const chA = randomUUID();
    const chB = randomUUID();
    channelIds.push(chA, chB);
    await seedMessage(chA, [{ metaDataId: 1, name: 'A dest', status: 'ERROR' }]);
    await seedMessage(chB, [{ metaDataId: 1, name: 'B dest', status: 'ERROR' }]);

    const result = unwrap(await mods.CrossChannelSearchService.search({
      status: 'ERROR', channelIds: chA, limit: 50, offset: 0,
    }));
    expect(result.total).toBe(1);
    expect(result.items[0]!.channelId).toBe(chA);
  });
});
