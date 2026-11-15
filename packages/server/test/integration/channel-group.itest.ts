// ===========================================
// Channel Group Service — real Postgres integration
// ===========================================
// The optimistic lock on a group update must hold when another writer changes
// the row between the service's revision check and its UPDATE. The test forces
// that interleaving with a row lock instead of hoping two calls overlap:
//
//   1. A separate connection locks the group row (SELECT ... FOR UPDATE).
//   2. The service update reads revision N (plain reads are not blocked), passes
//      its early check, and blocks on its UPDATE.
//   3. The locking connection bumps the revision to N+1 and commits.
//   4. Postgres re-checks the blocked UPDATE's WHERE against the new row. With
//      the revision in the WHERE nothing matches and the service answers
//      CONFLICT; with the id alone (the old code) it overwrote the other write.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { describeIntegration, unwrap } from './_setup.js';

const LOCK_WAIT_TIMEOUT_MS = 10_000;

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

  /**
   * Wait until the service's UPDATE is blocked on the locked row. A blocked row
   * UPDATE waits on the locker's transaction id, so it shows in pg_stat_activity
   * as a Lock wait with the UPDATE as its query.
   */
  async function waitForBlockedUpdate(): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ waiting: string }>(
        `SELECT count(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ILIKE 'update "channel_groups"%'`,
      );
      if (Number(rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The service UPDATE never blocked on the locked row');
  }

  it('answers CONFLICT when another writer bumps the revision after the check but before the UPDATE', async () => {
    const group = unwrap(await ChannelGroupService.create({ name: `itest-group-${Date.now()}`, description: '' }));
    groupId = group.id;

    const locker = await pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM channel_groups WHERE id = $1 FOR UPDATE', [group.id]);

      const pending = ChannelGroupService.update(group.id, { revision: group.revision, description: 'from service' });
      await waitForBlockedUpdate();

      await locker.query(
        'UPDATE channel_groups SET revision = revision + 1, description = $2 WHERE id = $1',
        [group.id, 'from other writer'],
      );
      await locker.query('COMMIT');

      const result = await pending;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    } finally {
      locker.release();
    }

    const after = unwrap(await ChannelGroupService.getById(group.id));
    expect(after.revision).toBe(group.revision + 1);
    expect(after.description).toBe('from other writer');
  });
});
