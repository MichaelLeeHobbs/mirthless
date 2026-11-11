// ===========================================
// Recovery queries — real Postgres integration
// ===========================================
// Recovery must only see messages an earlier run left behind, and must be
// able to page through them without reading one twice.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Recovery queries (real Postgres)', () => {
  let mods: ServerModules;

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function seed(channelId: string, processed: boolean): Promise<number> {
    const [row] = await mods.db
      .insert(mods.schema.messages)
      .values({ channelId, serverId: 'itest', processed })
      .returning({ id: mods.schema.messages.id });
    return row!.id;
  }

  it('getLatestMessageId returns 0 for a channel with no messages, else its newest id', async () => {
    const channelId = randomUUID();
    expect(unwrap(await mods.MessageService.getLatestMessageId(channelId))).toBe(0);

    await seed(channelId, true);
    const newest = await seed(channelId, false);
    await seed(randomUUID(), false);

    expect(unwrap(await mods.MessageService.getLatestMessageId(channelId))).toBe(newest);
  });

  it('pages unprocessed messages in id order and leaves out processed ones', async () => {
    const channelId = randomUUID();
    const a = await seed(channelId, false);
    await seed(channelId, true);
    const b = await seed(channelId, false);
    const c = await seed(channelId, false);

    const first = unwrap(await mods.MessageService.getUnprocessedMessages(channelId, { afterId: 0, maxId: c }, 2));
    expect(first.map((m) => m.id)).toEqual([a, b]);
    const second = unwrap(await mods.MessageService.getUnprocessedMessages(channelId, { afterId: b, maxId: c }, 2));
    expect(second.map((m) => m.id)).toEqual([c]);
  });

  it('never returns a message newer than the deploy horizon', async () => {
    const channelId = randomUUID();
    const old = await seed(channelId, false);
    const horizon = unwrap(await mods.MessageService.getLatestMessageId(channelId));
    await seed(channelId, false); // arrives after the channel started

    const page = unwrap(await mods.MessageService.getUnprocessedMessages(channelId, { afterId: 0, maxId: horizon }, 200));
    expect(page.map((m) => m.id)).toEqual([old]);
  });
});
