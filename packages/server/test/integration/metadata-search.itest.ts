// ===========================================
// Custom metadata search — real Postgres integration
// ===========================================
// Operators find a study's messages by a metadata column such as ACCESSION,
// and every message in the list shows its column values.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { messageSearchQuerySchema } from '@galvaniflow/core-models';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Message search by custom metadata (real Postgres)', () => {
  let mods: ServerModules;
  let MessageQueryService: typeof import('../../src/services/message-query.service.js').MessageQueryService;
  const channelId = randomUUID();
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    mods = await loadServerModules();
    ({ MessageQueryService } = await import('../../src/services/message-query.service.js'));
    const rows = [['first', { ACCESSION: 'ACC-1', SITE: 'NORTH' }], ['second', { ACCESSION: 'ACC-2', SITE: 'NORTH' }], ['bare', null]] as const;
    for (const [name, metadata] of rows) {
      const { messageId } = unwrap(await mods.MessageService.createMessage(channelId, 'itest'));
      if (metadata) unwrap(await mods.MessageService.storeCustomMetadata(channelId, messageId, 0, metadata));
      ids[name] = messageId;
    }
    // Storing again replaces the values.
    unwrap(await mods.MessageService.storeCustomMetadata(channelId, ids['second']!, 0, { ACCESSION: 'ACC-2', SITE: 'SOUTH' }));
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function search(query: Record<string, string>): Promise<ReadonlyArray<{ messageId: number; metaData: Readonly<Record<string, unknown>> }>> {
    const page = unwrap(await MessageQueryService.searchMessages(channelId, messageSearchQuerySchema.parse({ ...query, sortDir: 'asc', sort: 'messageId' })));
    return page.items;
  }

  it('finds only the message whose column equals the value, with its column values', async () => {
    expect(await search({ metaDataColumn: 'ACCESSION', metaDataValue: 'ACC-2' }))
      .toEqual([expect.objectContaining({ messageId: ids['second'], metaData: { ACCESSION: 'ACC-2', SITE: 'SOUTH' } })]);
  });

  it('finds the messages that have a column when no value is given', async () => {
    expect((await search({ metaDataColumn: 'SITE' })).map((m) => m.messageId)).toEqual([ids['first'], ids['second']]);
  });

  it('treats the column name and value as data, not SQL', async () => {
    expect(await search({ metaDataColumn: "ACCESSION' OR '1'='1", metaDataValue: 'ACC-1' })).toEqual([]);
  });

  it('gives a message without metadata an empty record', async () => {
    const all = await search({});
    expect(all.find((m) => m.messageId === ids['bare'])?.metaData).toEqual({});
  });
});
