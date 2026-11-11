// ===========================================
// Content removal after queued delivery — real Postgres integration
// ===========================================
// "Remove content on completion" must also apply to a message whose last
// destination was delivered from the queue, and must never remove content
// while another destination is unfinished or failed.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Content removal after queued delivery (real Postgres)', () => {
  let mods: ServerModules;
  let createMessageStoreAdapter: typeof import('../../src/engine.js').createMessageStoreAdapter;

  beforeAll(async () => {
    mods = await loadServerModules();
    ({ createMessageStoreAdapter } = await import('../../src/engine.js'));
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  /** A message with a source row, the given destination statuses, and one stored content row. */
  async function seed(sourceStatus: string, destinations: readonly string[]): Promise<{ channelId: string; messageId: number }> {
    const channelId = randomUUID();
    const { messageId } = unwrap(await mods.MessageService.createMessage(channelId, 'itest'));
    const statuses = [sourceStatus, ...destinations];
    for (const [metaDataId, status] of statuses.entries()) {
      unwrap(await mods.MessageService.createConnectorMessage(channelId, messageId, metaDataId, `c${String(metaDataId)}`, status as 'SENT'));
    }
    unwrap(await mods.MessageService.storeContent(channelId, messageId, 0, 1, 'MSH|raw', 'HL7V2', false));
    return { channelId, messageId };
  }

  async function contentRows(channelId: string, messageId: number): Promise<number> {
    const rows = await mods.db.select().from(mods.schema.messageContent).where(
      mods.and(mods.eq(mods.schema.messageContent.channelId, channelId), mods.eq(mods.schema.messageContent.messageId, messageId)),
    );
    return rows.length;
  }

  const keep = { messageStorageMode: 'DEVELOPMENT', removeContentOnCompletion: false, removeAttachmentsOnCompletion: false, encryptData: false } as const;
  const removing = { ...keep, removeContentOnCompletion: true } as const;

  it('isFullyDelivered is true only when every connector row is SENT or FILTERED', async () => {
    const done = await seed('SENT', ['SENT', 'FILTERED']);
    const queued = await seed('SENT', ['SENT', 'QUEUED']);
    const pending = await seed('SENT', ['PENDING']);
    const errored = await seed('ERROR', ['SENT', 'ERROR']);
    const inFlight = await seed('TRANSFORMED', ['SENT']);

    expect(unwrap(await mods.MessageService.isFullyDelivered(done.channelId, done.messageId))).toBe(true);
    for (const m of [queued, pending, errored, inFlight]) {
      expect(unwrap(await mods.MessageService.isFullyDelivered(m.channelId, m.messageId))).toBe(false);
    }
  });

  it('isFullyDelivered is false for a message with no connector rows', async () => {
    expect(unwrap(await mods.MessageService.isFullyDelivered(randomUUID(), 1))).toBe(false);
  });

  it('removes the content once the last queued destination is delivered', async () => {
    const m = await seed('SENT', ['SENT', 'SENT']);
    const store = createMessageStoreAdapter(removing);

    unwrap(await store.removeContentIfDelivered!(m.channelId, m.messageId));

    expect(await contentRows(m.channelId, m.messageId)).toBe(0);
  });

  it('keeps the content while another destination is still queued', async () => {
    const m = await seed('SENT', ['SENT', 'QUEUED']);
    const store = createMessageStoreAdapter(removing);

    unwrap(await store.removeContentIfDelivered!(m.channelId, m.messageId));

    expect(await contentRows(m.channelId, m.messageId)).toBe(1);
  });

  it('keeps the content when a destination failed, so it can be investigated', async () => {
    const m = await seed('ERROR', ['SENT', 'ERROR']);
    const store = createMessageStoreAdapter(removing);

    unwrap(await store.removeContentIfDelivered!(m.channelId, m.messageId));

    expect(await contentRows(m.channelId, m.messageId)).toBe(1);
  });

  it('keeps the content when the channel does not ask for removal', async () => {
    const m = await seed('SENT', ['SENT']);
    const store = createMessageStoreAdapter(keep);

    unwrap(await store.removeContentIfDelivered!(m.channelId, m.messageId));

    expect(await contentRows(m.channelId, m.messageId)).toBe(1);
  });
});
