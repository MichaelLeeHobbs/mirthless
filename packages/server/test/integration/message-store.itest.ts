// The unit tests of these statements mock the database, so only this shows the SQL is valid.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import {
  deleteTestChannel, describeIntegration, insertTestChannel, loadServerModules, unwrap, type ServerModules,
} from './_setup.js';

describeIntegration('Message store statements (real Postgres)', () => {
  let mods: ServerModules;
  const channelId = randomUUID();

  beforeAll(async () => {
    mods = await loadServerModules();
    await insertTestChannel(mods, channelId);
    unwrap(await mods.PartitionManagerService.createPartitions(channelId));
  });

  afterAll(async () => {
    await mods?.PartitionManagerService.dropPartitions(channelId);
    if (mods) await deleteTestChannel(mods, channelId);
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

  it('refuses raw content with U+0000 in plain text, and takes it in a source map, where JSON escapes it', async () => {
    const { MessageService } = mods;
    const row = (contentType: number, content: string): Parameters<typeof MessageService.initializeMessage>[3] => [{ metaDataId: 0, contentType, content, dataType: 'HL7V2' }];

    // A batch is refused up front on this (D-364).
    const raw = await MessageService.initializeMessage(channelId, 'itest-server', 'Source', row(CONTENT_TYPE.RAW, 'MSH|\u0000'));
    const sourceMap = await MessageService.initializeMessage(channelId, 'itest-server', 'Source', row(CONTENT_TYPE.SOURCE_MAP, JSON.stringify({ name: '\u0000' })));

    expect(raw.ok).toBe(false);
    expect(sourceMap.ok).toBe(true);
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
