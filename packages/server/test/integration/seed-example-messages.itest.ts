// ===========================================
// Example Messages Seed — real Postgres integration
// ===========================================
// Seeds the example channels + showcase headline channel, runs
// seedExampleMessages(), and asserts that browsable messages + content rows
// land through the real MessageService write-path. Also asserts idempotency
// (a second run is a no-op) and the HL7 ADT Router -> HL7-to-JSON correlation.
//
// Runs only against a *_test database (see _setup.ts gating).

import { beforeAll, afterAll, expect, it } from 'vitest';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

const CASCADE_CORRELATION_ID = '11111111-1111-4111-8111-111111111111';

describeIntegration('Example messages seed (real Postgres)', () => {
  let mods: ServerModules;

  beforeAll(async () => {
    mods = await loadServerModules();
    // Ensure the example + showcase channels exist before seeding messages.
    const { seedExampleChannels } = await import('../../src/db/seeds/seed-examples.js');
    const { seedShowcase } = await import('../../src/db/seeds/seed-showcase.js');
    await seedExampleChannels(mods.db);
    await seedShowcase(mods.db);
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function findChannelId(name: string): Promise<string> {
    const { db, schema, eq } = mods;
    const [row] = await db
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.name, name));
    if (!row) throw new Error(`channel not found: ${name}`);
    return row.id;
  }

  async function messageCount(channelId: string): Promise<number> {
    const { db, schema, sql, eq } = mods;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(eq(schema.messages.channelId, channelId));
    return row?.n ?? 0;
  }

  async function connectorCount(channelId: string, status: string): Promise<number> {
    const { db, schema, sql, eq, and } = mods;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.connectorMessages)
      .where(and(eq(schema.connectorMessages.channelId, channelId), eq(schema.connectorMessages.status, status)));
    return row?.n ?? 0;
  }

  async function contentCount(channelId: string, contentType: number): Promise<number> {
    const { db, schema, sql, eq, and } = mods;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messageContent)
      .where(and(eq(schema.messageContent.channelId, channelId), eq(schema.messageContent.contentType, contentType)));
    return row?.n ?? 0;
  }

  async function correlationCount(channelId: string, correlationId: string): Promise<number> {
    const { db, schema, sql, eq, and } = mods;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, channelId), eq(schema.messages.correlationId, correlationId)));
    return row?.n ?? 0;
  }

  it('seeds browsable messages + content rows for the example channels', async () => {
    const { seedExampleMessages } = await import('../../src/db/seeds/seed-example-messages.js');
    await seedExampleMessages();

    // Basic channel: source-only messages with RAW content.
    const echoId = await findChannelId('Example: Echo (RAW)');
    expect(await messageCount(echoId)).toBe(2);
    expect(await contentCount(echoId, 1)).toBe(2); // CT RAW
    expect(await connectorCount(echoId, 'SENT')).toBe(2);

    // Round-trip: MessageService can read back the seeded RAW content.
    const { db, schema, MessageService, eq } = mods;
    const [firstMsg] = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.channelId, echoId))
      .limit(1);
    const loaded = unwrap(await MessageService.loadContent(echoId, firstMsg!.id, 0, 1));
    expect(loaded).toContain('TEST echo message');
  });

  it('records FILTERED and ERROR (with PROCESSING_ERROR content) non-happy paths', async () => {
    const { seedExampleMessages } = await import('../../src/db/seeds/seed-example-messages.js');
    await seedExampleMessages(); // idempotent: no-op here

    // Filter Demo: one message filtered at the source.
    const filterId = await findChannelId('Example: Filter Demo');
    expect(await connectorCount(filterId, 'FILTERED')).toBeGreaterThanOrEqual(1);

    // Multi-Destination: a destination errored with a PROCESSING_ERROR content row.
    const multiId = await findChannelId('Example: Multi-Destination');
    expect(await connectorCount(multiId, 'ERROR')).toBeGreaterThanOrEqual(1);
    expect(await contentCount(multiId, 13)).toBeGreaterThanOrEqual(1); // CT PROCESSING_ERROR
  });

  it('links the HL7 ADT Router -> HL7-to-JSON cascade via a shared correlation id', async () => {
    const routerId = await findChannelId('Example: HL7 ADT Router');
    const jsonId = await findChannelId('Example: HL7 to JSON');
    expect(await correlationCount(routerId, CASCADE_CORRELATION_ID)).toBe(1);
    expect(await correlationCount(jsonId, CASCADE_CORRELATION_ID)).toBe(1);
  });

  it('is idempotent: a second run adds no new messages', async () => {
    const { seedExampleMessages } = await import('../../src/db/seeds/seed-example-messages.js');
    const echoId = await findChannelId('Example: Echo (RAW)');
    const multiId = await findChannelId('Example: Multi-Destination');
    const before = (await messageCount(echoId)) + (await messageCount(multiId));

    await seedExampleMessages();

    const after = (await messageCount(echoId)) + (await messageCount(multiId));
    expect(after).toBe(before);
    // Echo must still hold exactly its seeded two messages (no duplication).
    expect(await messageCount(echoId)).toBe(2);
  });
});
