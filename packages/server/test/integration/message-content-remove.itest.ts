// ===========================================
// Removing one content type — real Postgres integration
// ===========================================
// A queued destination that delivers after failing drops the earlier failure
// reason and nothing else.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('MessageService.removeContent (real Postgres)', () => {
  let mods: ServerModules;
  const channelId = randomUUID();

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  it('removes only the content type it names, on the connector it names', async () => {
    const { MessageService } = mods;
    const { messageId } = unwrap(await MessageService.createMessage(channelId, 'itest'));
    unwrap(await MessageService.storeContent(channelId, messageId, 1, 5, 'SENT body', 'TEXT', false));
    unwrap(await MessageService.storeContent(channelId, messageId, 1, 11, 'HTTP 500', 'TEXT', false));
    unwrap(await MessageService.storeContent(channelId, messageId, 2, 11, 'other destination', 'TEXT', false));

    unwrap(await MessageService.removeContent(channelId, messageId, 1, 11));
    unwrap(await MessageService.removeContent(channelId, messageId, 1, 11));

    expect(unwrap(await MessageService.loadContent(channelId, messageId, 1, 11))).toBeNull();
    expect(unwrap(await MessageService.loadContent(channelId, messageId, 1, 5))).toBe('SENT body');
    expect(unwrap(await MessageService.loadContent(channelId, messageId, 2, 11))).toBe('other destination');
  });
});
