// ===========================================
// Channel CRUD + Message round trip — real Postgres integration
// ===========================================
// Creates a channel through the real service (multi-table transaction: channel
// row + default scripts + partition attempt + Default-group assignment), then
// pushes a message through the store/load content path and tears the channel
// down via soft-delete. Catches schema drift the mocked-db unit tests can't.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { CreateChannelInput } from '@mirthless/core-models';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Channel CRUD + message round trip (real Postgres)', () => {
  let mods: ServerModules;

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  function makeChannelInput(): CreateChannelInput {
    return {
      name: `itest-channel-${randomUUID()}`,
      description: 'integration test channel',
      enabled: false,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'JAVASCRIPT',
      sourceConnectorProperties: {},
      responseMode: 'AUTO_AFTER_DESTINATIONS',
    };
  }

  it('creates, reads, round-trips a message, and soft-deletes a channel', async () => {
    const { ChannelService, MessageService } = mods;
    const input = makeChannelInput();

    // Create — real multi-table transaction.
    const created = unwrap(await ChannelService.create(input));
    expect(created.name).toBe(input.name);
    const channelId = created.id;

    // Read back.
    const fetched = unwrap(await ChannelService.getById(channelId));
    expect(fetched.id).toBe(channelId);
    expect(fetched.sourceConnectorType).toBe('JAVASCRIPT');

    // Message round trip: create -> store content -> load content.
    const payload = 'MSH|^~\\&|itest|itest|dest|dest|20260712||ADT^A01|1|P|2.5';
    const message = unwrap(await MessageService.createMessage(channelId, 'itest-server'));
    unwrap(await MessageService.createConnectorMessage(channelId, message.messageId, 0, 'source', 'RECEIVED'));
    unwrap(await MessageService.storeContent(channelId, message.messageId, 0, 1, payload, 'HL7V2'));

    const loaded = unwrap(await MessageService.loadContent(channelId, message.messageId, 0, 1));
    expect(loaded).toBe(payload);

    // Soft-delete — subsequent reads must report NOT_FOUND.
    unwrap(await ChannelService.delete(channelId));
    const afterDelete = await ChannelService.getById(channelId);
    expect(afterDelete.ok).toBe(false);
  });

  it('rejects a duplicate channel name', async () => {
    const { ChannelService } = mods;
    const input = makeChannelInput();

    unwrap(await ChannelService.create(input));
    const dup = await ChannelService.create({ ...input });
    expect(dup.ok).toBe(false);
  });
});
