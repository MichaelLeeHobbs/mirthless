// Unit tests mock db.execute, so only this suite shows the SQL is valid Postgres
// and that concurrent pollers never double-claim a queued message.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('QueueManager (real Postgres)', () => {
  let mods: ServerModules;

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function seedQueued(channelId: string, metaDataId: number, count: number): Promise<void> {
    const { MessageService } = mods;
    for (let i = 0; i < count; i++) {
      const created = unwrap(await MessageService.createMessage(channelId, 'itest-server'));
      const r = await MessageService.createConnectorMessage(
        channelId,
        created.messageId,
        metaDataId,
        'destination',
        'QUEUED',
      );
      unwrap(r);
    }
  }

  it('claims QUEUED messages and transitions them to PENDING (SKIP LOCKED)', async () => {
    const { MessageService, QueueManagerService } = mods;
    const channelId = randomUUID();
    const metaDataId = 1;
    await seedQueued(channelId, metaDataId, 5);

    const depthBefore = unwrap(await QueueManagerService.getQueueDepth(channelId, metaDataId));
    expect(depthBefore.depth).toBe(5);

    const claimed = unwrap(await MessageService.dequeue(channelId, metaDataId, 3));
    expect(claimed).toHaveLength(3);
    expect(claimed.every((m) => m.status === 'PENDING')).toBe(true);

    const depthAfter = unwrap(await QueueManagerService.getQueueDepth(channelId, metaDataId));
    expect(depthAfter.depth).toBe(2);
  });

  it('never double-claims under concurrent dequeue', async () => {
    const { MessageService } = mods;
    const channelId = randomUUID();
    const metaDataId = 1;
    await seedQueued(channelId, metaDataId, 10);

    const [batchA, batchB] = await Promise.all([
      MessageService.dequeue(channelId, metaDataId, 10),
      MessageService.dequeue(channelId, metaDataId, 10),
    ]);

    const idsA = unwrap(batchA).map((m) => m.messageId);
    const idsB = unwrap(batchB).map((m) => m.messageId);
    const all = [...idsA, ...idsB];

    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeLessThanOrEqual(10);
    expect(all.length).toBeGreaterThan(0);
  });

  it('release() moves a claimed message to a terminal status', async () => {
    const { MessageService, QueueManagerService } = mods;
    const channelId = randomUUID();
    const metaDataId = 1;
    await seedQueued(channelId, metaDataId, 1);

    const [claimed] = unwrap(await MessageService.dequeue(channelId, metaDataId, 1));
    expect(claimed).toBeDefined();
    if (!claimed) return;

    unwrap(await MessageService.release(channelId, claimed.messageId, metaDataId, 'SENT'));

    const rows = unwrap(await QueueManagerService.getQueueDepth(channelId, metaDataId));
    expect(rows.depth).toBe(0);
  });
});
