// ===========================================
// Channel Group Service — real Postgres integration
// ===========================================
// The optimistic lock on a group update must hold under concurrency: two
// updates that read the same revision cannot both succeed.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { describeIntegration, unwrap } from './_setup.js';

describeIntegration('ChannelGroupService.update (real Postgres)', () => {
  let ChannelGroupService: typeof import('../../src/services/channel-group.service.js').ChannelGroupService;
  let pool: typeof import('../../src/lib/db.js').pool;
  let groupId: string | null = null;

  beforeAll(async () => {
    ({ ChannelGroupService } = await import('../../src/services/channel-group.service.js'));
    ({ pool } = await import('../../src/lib/db.js'));
  });

  afterEach(async () => {
    if (groupId) unwrap(await ChannelGroupService.delete(groupId));
    groupId = null;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('lets only one of two concurrent updates at the same revision succeed', async () => {
    const group = unwrap(await ChannelGroupService.create({ name: `itest-group-${Date.now()}`, description: '' }));
    groupId = group.id;

    const results = await Promise.all([
      ChannelGroupService.update(group.id, { revision: group.revision, description: 'first' }),
      ChannelGroupService.update(group.id, { revision: group.revision, description: 'second' }),
    ]);

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toHaveProperty('code', 'CONFLICT');

    const after = unwrap(await ChannelGroupService.getById(group.id));
    expect(after.revision).toBe(group.revision + 1);
  });
});
