// ===========================================
// Message content search — real Postgres integration
// ===========================================
// What the user types is text to find, not a pattern: % and _ must match
// themselves.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Message content search (real Postgres)', () => {
  let mods: ServerModules;
  let MessageQueryService: typeof import('../../src/services/message-query.service.js').MessageQueryService;
  const channelId = randomUUID();
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    mods = await loadServerModules();
    ({ MessageQueryService } = await import('../../src/services/message-query.service.js'));
    for (const [name, content] of [['percent', 'dose 100% given'], ['plain', 'dose 1000 given'], ['underscore', 'code A_B'], ['letter', 'code AXB']] as const) {
      const { messageId } = unwrap(await mods.MessageService.createMessage(channelId, 'itest'));
      unwrap(await mods.MessageService.storeContent(channelId, messageId, 0, 1, content, 'RAW', false));
      ids[name] = messageId;
    }
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function search(contentSearch: string): Promise<readonly number[]> {
    const page = unwrap(await MessageQueryService.searchMessages(channelId, { contentSearch, limit: 50, offset: 0 } as never));
    return page.items.map((m: { messageId: number }) => m.messageId).sort((a: number, b: number) => a - b);
  }

  it('finds a percent sign as a percent sign', async () => {
    expect(await search('100%')).toEqual([ids['percent']]);
  });

  it('finds an underscore as an underscore', async () => {
    expect(await search('A_B')).toEqual([ids['underscore']]);
  });

  it('still matches text anywhere in the content, ignoring case', async () => {
    expect(await search('DOSE')).toEqual([ids['percent'], ids['plain']].sort((a, b) => a! - b!));
  });
});
