// ===========================================
// Message store statements — real Postgres integration
// ===========================================
// Statements whose unit tests mock the database and so cannot show that the SQL
// is valid: bulk delete by id list, storing the same content type twice, and the
// rotating queue order.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Message store statements (real Postgres)', () => {
  let mods: ServerModules;
  const channelId = randomUUID();

  beforeAll(async () => {
    mods = await loadServerModules();
    unwrap(await mods.PartitionManagerService.createPartitions(channelId));
  });

  afterAll(async () => {
    await mods?.PartitionManagerService.dropPartitions(channelId);
    await mods?.pool.end();
  });

  async function newMessage(): Promise<number> {
    return Number(unwrap(await mods.MessageService.createMessage(channelId, 'itest-server')).messageId);
  }

  it('bulk delete removes one message, several messages, and only those', async () => {
    const { MessageReprocessService } = await import('../../src/services/message-reprocess.service.js');
    const ids = [await newMessage(), await newMessage(), await newMessage(), await newMessage()];

    expect(unwrap(await MessageReprocessService.bulkDelete(channelId, [ids[0]!])).deletedCount).toBe(1);
    expect(unwrap(await MessageReprocessService.bulkDelete(channelId, [ids[1]!, ids[2]!, 999_999_999])).deletedCount).toBe(2);

    const missing = await MessageReprocessService.bulkDelete(channelId, [ids[0]!]);
    expect(missing.ok).toBe(false);
    const kept = await MessageReprocessService.bulkDelete(channelId, [ids[3]!]);
    expect(kept.ok && kept.value.deletedCount).toBe(1);
  });

  it('storing the same content type again keeps the newest content', async () => {
    const { MessageService } = mods;
    const messageId = await newMessage();

    unwrap(await MessageService.storeContent(channelId, messageId, 0, 13, 'first error', 'TEXT'));
    unwrap(await MessageService.storeContent(channelId, messageId, 0, 13, 'second error', 'TEXT'));

    expect(unwrap(await MessageService.loadContent(channelId, messageId, 0, 13))).toBe('second error');
  });

  it('a rotating queue hands out the least-attempted messages first', async () => {
    const { MessageService } = mods;
    const metaDataId = 7;
    const first = await newMessage();
    const second = await newMessage();
    for (const id of [first, second]) {
      unwrap(await MessageService.createConnectorMessage(channelId, id, metaDataId, 'destination', 'QUEUED'));
    }
    // One failed attempt on the older message: PENDING, then back to QUEUED (+1 attempt).
    unwrap(await MessageService.dequeue(channelId, metaDataId, 1));
    unwrap(await MessageService.updateConnectorMessageStatus(channelId, first, metaDataId, 'QUEUED'));

    const inOrder = unwrap(await MessageService.dequeue(channelId, metaDataId, 1));
    unwrap(await MessageService.release(channelId, Number(inOrder[0]!.messageId), metaDataId, 'QUEUED'));
    const rotated = unwrap(await MessageService.dequeue(channelId, metaDataId, 1, true));

    expect(Number(inOrder[0]!.messageId)).toBe(first);
    expect(Number(rotated[0]!.messageId)).toBe(second);
  });
});
