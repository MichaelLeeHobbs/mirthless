// ===========================================
// Channel Group Service — real Postgres integration
// ===========================================
// Both suites force a concurrent writer into a set point with a row lock instead
// of hoping two calls overlap.
//
// update: the optimistic lock on a group update must hold when another writer
// changes the row between the service's revision check and its UPDATE.
//
//   1. A separate connection locks the group row (SELECT ... FOR UPDATE).
//   2. The service update reads revision N (plain reads are not blocked), passes
//      its early check, and blocks on its UPDATE.
//   3. The locking connection bumps the revision to N+1 and commits.
//   4. Postgres re-checks the blocked UPDATE's WHERE against the new row. With
//      the revision in the WHERE nothing matches and the service answers
//      CONFLICT; with the id alone (the old code) it overwrote the other write.
//
// setChannelGroups (#223): a set that fails after it removed the old
// memberships must leave them in place.
//
//   1. A separate connection inserts the same membership the service will
//      insert and holds its transaction open (a writer that bypasses the
//      service, so the channel lock does not order it).
//   2. The service locks the channel and groups, removes the channel's
//      memberships, and blocks on the primary key of its INSERT.
//   3. The other connection commits, the INSERT fails on the duplicate key, and
//      the transaction rolls back, so the channel keeps its old group. Run as
//      separate calls (the old web code), the old group would be gone.
//
// A group deleted during a set: the service locks the groups FOR KEY SHARE
// before it removes anything, so it waits for the delete and answers NOT_FOUND
// with the memberships untouched, instead of failing the INSERT later.

import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createChannelSchema } from '@galvanigraph/core-models';
import { describeIntegration, unwrap } from './_setup.js';

const LOCK_WAIT_TIMEOUT_MS = 10_000;

describeIntegration('ChannelGroupService (real Postgres)', () => {
  let ChannelGroupService: typeof import('../../src/services/channel-group.service.js').ChannelGroupService;
  let ChannelService: typeof import('../../src/services/channel.service.js').ChannelService;
  let pool: typeof import('../../src/lib/db.js').pool;
  let groupIds: string[] = [];
  let channelIds: string[] = [];

  beforeAll(async () => {
    ({ ChannelGroupService } = await import('../../src/services/channel-group.service.js'));
    ({ ChannelService } = await import('../../src/services/channel.service.js'));
    ({ pool } = await import('../../src/lib/db.js'));
  });

  afterEach(async () => {
    // A group the test deleted itself answers NOT_FOUND here, which is fine.
    for (const id of groupIds) await ChannelGroupService.delete(id);
    // ChannelService.delete only marks a channel deleted. Remove the rows so runs
    // don't pile up channels and their Default group memberships (cascade).
    if (channelIds.length > 0) await pool.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [channelIds]);
    groupIds = [];
    channelIds = [];
  });

  afterAll(async () => {
    await pool?.end();
  });

  /**
   * Wait until a statement starting with `queryPrefix` is blocked on a lock. A
   * blocked statement waits on the locker's transaction id, so it shows in
   * pg_stat_activity as a Lock wait with the statement as its query.
   */
  async function waitForBlocked(queryPrefix: string): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ waiting: string }>(
        `SELECT count(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ILIKE $1`,
        [`${queryPrefix}%`],
      );
      if (Number(rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No statement starting "${queryPrefix}" ever blocked on the locked row`);
  }

  async function makeGroup(name: string): Promise<string> {
    const group = unwrap(await ChannelGroupService.create({ name: `itest-${name}-${randomUUID().slice(0, 8)}`, description: '' }));
    groupIds.push(group.id);
    return group.id;
  }

  async function makeChannel(): Promise<string> {
    const channel = unwrap(await ChannelService.create(createChannelSchema.parse({
      name: `itest-groups-${randomUUID().slice(0, 8)}`, enabled: false, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'AUTO_AFTER_DESTINATIONS',
    })));
    channelIds.push(channel.id);
    return channel.id;
  }

  async function groupsOf(channelId: string): Promise<string[]> {
    const memberships = unwrap(await ChannelGroupService.listMemberships());
    return memberships.filter((m) => m.channelId === channelId).map((m) => m.channelGroupId).sort();
  }

  describe('update', () => {
    it('answers CONFLICT when another writer bumps the revision after the check but before the UPDATE', async () => {
      const group = unwrap(await ChannelGroupService.create({ name: `itest-group-${randomUUID().slice(0, 8)}`, description: '' }));
      groupIds.push(group.id);

      const locker = await pool.connect();
      try {
        await locker.query('BEGIN');
        await locker.query('SELECT id FROM channel_groups WHERE id = $1 FOR UPDATE', [group.id]);

        const pending = ChannelGroupService.update(group.id, { revision: group.revision, description: 'from service' });
        await waitForBlocked('update "channel_groups"');

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
        // Ends the locker's transaction if the test failed before COMMIT (a no-op after it).
        await locker.query('ROLLBACK');
        locker.release();
      }

      const after = unwrap(await ChannelGroupService.getById(group.id));
      expect(after.revision).toBe(group.revision + 1);
      expect(after.description).toBe('from other writer');
    });
  });

  describe('setChannelGroups', () => {
    it('replaces the channel\'s groups, and an empty list takes it out of every group', async () => {
      const channelId = await makeChannel();
      const a = await makeGroup('a');
      const b = await makeGroup('b');

      unwrap(await ChannelGroupService.setChannelGroups(channelId, [a, b]));
      expect(await groupsOf(channelId)).toEqual([a, b].sort());

      unwrap(await ChannelGroupService.setChannelGroups(channelId, [b]));
      expect(await groupsOf(channelId)).toEqual([b]);

      unwrap(await ChannelGroupService.setChannelGroups(channelId, []));
      expect(await groupsOf(channelId)).toEqual([]);
    });

    it('answers NOT_FOUND for an unknown group and leaves the memberships alone', async () => {
      const channelId = await makeChannel();
      const a = await makeGroup('a');
      unwrap(await ChannelGroupService.setChannelGroups(channelId, [a]));

      const result = await ChannelGroupService.setChannelGroups(channelId, [randomUUID()]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
      expect(await groupsOf(channelId)).toEqual([a]);
    });

    it('answers NOT_FOUND for an unknown channel', async () => {
      const a = await makeGroup('a');

      const result = await ChannelGroupService.setChannelGroups(randomUUID(), [a]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('answers NOT_FOUND for a deleted channel, as GET /channels/:id does', async () => {
      const channelId = await makeChannel();
      const a = await makeGroup('a');
      unwrap(await ChannelService.delete(channelId));

      const result = await ChannelGroupService.setChannelGroups(channelId, [a]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
      expect(await groupsOf(channelId)).not.toContain(a);
    });

    it('answers NOT_FOUND, with the memberships untouched, for a group deleted during the set', async () => {
      const channelId = await makeChannel();
      const from = await makeGroup('from');
      const to = await makeGroup('to');
      unwrap(await ChannelGroupService.setChannelGroups(channelId, [from]));

      const locker = await pool.connect();
      try {
        await locker.query('BEGIN');
        await locker.query('DELETE FROM channel_groups WHERE id = $1', [to]);

        const pending = ChannelGroupService.setChannelGroups(channelId, [to]);
        await waitForBlocked('select "id" from "channel_groups"');
        await locker.query('COMMIT');

        const result = await pending;
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toHaveProperty('code', 'NOT_FOUND');
      } finally {
        // Ends the locker's transaction if the test failed before COMMIT (a no-op after it).
        await locker.query('ROLLBACK');
        locker.release();
      }

      expect(await groupsOf(channelId)).toEqual([from]);
    });

    it('rolls back the removal when the insert fails, so the channel keeps its old group', async () => {
      const channelId = await makeChannel();
      const from = await makeGroup('from');
      const to = await makeGroup('to');
      unwrap(await ChannelGroupService.setChannelGroups(channelId, [from]));

      const locker = await pool.connect();
      try {
        await locker.query('BEGIN');
        await locker.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [to, channelId]);

        const pending = ChannelGroupService.setChannelGroups(channelId, [to]);
        await waitForBlocked('insert into "channel_group_members"');
        await locker.query('COMMIT');

        const result = await pending;
        expect(result.ok).toBe(false);
      } finally {
        // Ends the locker's transaction if the test failed before COMMIT (a no-op after it).
        await locker.query('ROLLBACK');
        locker.release();
      }

      // The old group survives; the other writer's membership is its own.
      expect(await groupsOf(channelId)).toEqual([from, to].sort());
    });
  });
});
