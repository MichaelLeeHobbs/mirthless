// What waits on a destination's queue goes to that destination or to nobody, whatever a save does to
// the channel meanwhile (#395, D-348).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE, createChannelSchema, updateChannelSchema } from '@galvanigraph/core-models';
import type { ChannelDetail } from '../../src/services/channel.service.js';
import { adminActor, deleteTestChannel, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';
import { databaseDestination } from './_database-destination.js';

describeIntegration('Queued messages and edited destinations (real Postgres, real database destinations)', () => {
  const TABLE = 'itest_queued_destination';
  const WAIT = 15_000;
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js').DeploymentService;
  let reprocess: typeof import('../../src/services/message-reprocess.service.js').MessageReprocessService;
  let engineMod: typeof import('../../src/engine.js');
  let channel: ChannelDetail | null = null;

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    ({ DeploymentService: deployment } = await import('../../src/services/deployment.service.js'));
    ({ MessageReprocessService: reprocess } = await import('../../src/services/message-reprocess.service.js'));
    engineMod = await import('../../src/engine.js');
  });

  beforeEach(async () => {
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await mods.pool.query(`CREATE TABLE ${TABLE} (partner text, message_id bigint)`);
  });

  afterEach(async () => {
    if (channel) {
      await deployment.stop(channel.id, actor);
      await deployment.undeploy(channel.id, actor);
      await deleteTestChannel(mods, channel.id);
      channel = null;
    }
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  afterAll(async () => {
    if (engineMod) await engineMod.getEngine().dispose();
    await mods?.pool.end();
  });

  const partner = (name: string, queueMode = 'ALWAYS'): Record<string, unknown> =>
    databaseDestination(name, queueMode, `INSERT INTO ${TABLE} VALUES ('${name}', \${messageId}::bigint)`);

  /** A channel with Lab A (1) and Clinic B (2), and a message that waits for Lab A. */
  async function waiting(name?: string): Promise<number> {
    channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-395-${randomUUID()}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      destinations: [partner('Lab A'), partner('Clinic B')],
    }), actor));
    return queue(name);
  }

  async function queue(name = 'Lab A'): Promise<number> {
    const { MessageService } = mods;
    const { messageId } = unwrap(await MessageService.createMessage(channel!.id, 'itest'));
    unwrap(await MessageService.createConnectorMessage(channel!.id, messageId, 0, 'Source', 'SENT'));
    unwrap(await MessageService.createConnectorMessage(channel!.id, messageId, 1, name, 'QUEUED'));
    unwrap(await MessageService.storeContent(channel!.id, messageId, 1, CONTENT_TYPE.SENT, 'PHI for Lab A', 'RAW'));
    unwrap(await MessageService.markProcessed(channel!.id, messageId));
    return messageId;
  }

  async function setOldNumbers(oldNumbers: unknown): Promise<void> {
    await mods.pool.query('UPDATE channels SET old_numbers = $2 WHERE id = $1', [channel!.id, JSON.stringify(oldNumbers)]);
  }

  /** As the migration left the channel, with what is stored now as what was stored then. */
  async function upgraded(oldNumbers: unknown): Promise<void> {
    await mods.pool.query('UPDATE connector_messages SET number_kept = false WHERE channel_id = $1', [channel!.id]);
    await setOldNumbers(oldNumbers);
  }

  const isForItsNumber = async (messageId: number): Promise<boolean> => unwrap(await mods.MessageService.isForItsNumber(channel!.id, messageId, 1));

  async function save(change: (named: (name: string) => Record<string, unknown>) => readonly Record<string, unknown>[]): Promise<void> {
    const now = unwrap(await mods.ChannelService.getById(channel!.id));
    const destinations = change((name) => ({ ...now.destinations.find((d) => d.name === name)! }));
    channel = unwrap(await mods.ChannelService.update(now.id, updateChannelSchema.parse({ revision: now.revision, enabled: true, destinations }), actor));
  }

  async function deploy(): Promise<void> {
    const id = channel!.id;
    if (engineMod.getEngine().getRuntime(id)) unwrap(await deployment.redeploy(id, actor));
    else unwrap(await deployment.deploy(id, actor));
    if (engineMod.getEngine().getRuntime(id)!.runtime.getState() !== 'STARTED') unwrap(await deployment.start(id, actor));
  }

  const received = async (): Promise<unknown[]> =>
    (await mods.pool.query(`SELECT partner, message_id::int AS "messageId" FROM ${TABLE}`)).rows;

  async function status(messageId: number): Promise<string | undefined> {
    return unwrap(await mods.MessageService.getConnectorMessages(channel!.id, messageId)).find((c) => c.metaDataId === 1)?.status;
  }

  async function held(): Promise<unknown[]> {
    const { rows } = await mods.pool.query<{ attributes: unknown }>(`SELECT attributes FROM events WHERE name = 'QUEUE_HELD' AND channel_id = $1`, [channel!.id]);
    return rows.map((r) => r.attributes);
  }

  /** Long enough for a queue consumer to have looked at its queue twice. */
  const lookedTwice = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 2_500); });

  it('a removed destination\'s go to nobody, and the start says that they wait', async () => {
    const messageId = await waiting();
    await save((named) => [named('Clinic B')]);

    await deploy();
    await vi.waitFor(async () => { expect(await held()).toEqual([{ metaDataId: 1, waiting: 1, destination: null, why: 'which the channel no longer has' }]); }, WAIT);
    await lookedTwice();

    expect(await received()).toEqual([]);
    expect(await status(messageId)).toBe('QUEUED');
  });

  it('those of one replaced by another go to nobody, also when the new one has its name and its place', async () => {
    const messageId = await waiting();
    await save((named) => [{ ...partner('Lab A'), id: 'new' }, named('Clinic B')]);

    await deploy();
    await lookedTwice();

    expect(await received()).toEqual([]);
    expect(await status(messageId)).toBe('QUEUED');
  });

  it('go to their destination when it has been moved and renamed', async () => {
    const messageId = await waiting();
    await save((named) => [named('Clinic B'), { ...named('Lab A'), name: 'Laboratory' }]);

    await deploy();

    await vi.waitFor(async () => { expect(await status(messageId)).toBe('SENT'); }, WAIT);
    expect(await received()).toEqual([{ partner: 'Lab A', messageId }]);
  });

  it.each([
    ['is switched off', { enabled: false }, 'which is switched off', 'switched off'],
    ['does not queue', { queueMode: 'NEVER' }, 'whose queue is off', 'not queue-enabled'],
  ])('wait for a destination that %s, a claim that a server stop left included, and go when that is undone', async (_what, change, why, refusal) => {
    const messageId = await waiting();
    await mods.pool.query(`UPDATE connector_messages SET status = 'PENDING' WHERE channel_id = $1 AND meta_data_id = 1`, [channel!.id]);
    await save((named) => [{ ...named('Lab A'), ...change }, named('Clinic B')]);

    await deploy();
    await vi.waitFor(async () => { expect(await held()).toEqual([{ metaDataId: 1, waiting: 1, destination: 'Lab A', why }]); }, WAIT);
    await lookedTwice();
    expect(await received()).toEqual([]);
    expect(await status(messageId)).toBe('QUEUED');
    expect(await reprocess.resendDestination(channel!.id, messageId, 1, actor)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining(refusal) } });

    await save((named) => [{ ...named('Lab A'), enabled: true, queueMode: 'ALWAYS' }, named('Clinic B')]);
    await deploy();
    await vi.waitFor(async () => { expect(await status(messageId)).toBe('SENT'); }, WAIT);
    expect(await received()).toEqual([{ partner: 'Lab A', messageId }]);
  });

  describe('from before saves kept the numbers', () => {
    it('go to the destination that had their name then, also when it has been renamed', async () => {
      const messageId = await waiting();
      await upgraded({ names: { 1: 'Lab A', 2: 'Clinic B' } });
      await save((named) => [{ ...named('Lab A'), name: 'Laboratory' }, named('Clinic B')]);

      await deploy();

      await vi.waitFor(async () => { expect(await status(messageId)).toBe('SENT'); }, WAIT);
      expect(await received()).toEqual([{ partner: 'Lab A', messageId }]);
    });

    it.each([
      ['had another name', { 1: 'Clinic B', 2: 'Lab A' }],
      ['shared its name with another', { 2: 'Clinic B' }],
    ])('stay on the queue of one that %s then, whatever it is called now, behind which newer ones go', async (_what, names) => {
      const old = await waiting();
      await upgraded({ names });
      const newer = await queue();
      await save((named) => [named('Lab A'), { ...named('Clinic B'), name: 'Clinic' }]);

      await deploy();

      await vi.waitFor(async () => { expect(await status(newer)).toBe('SENT'); }, WAIT);
      await lookedTwice();
      expect(await received()).toEqual([{ partner: 'Lab A', messageId: newer }]);
      expect(await status(old)).toBe('QUEUED');
      expect(await held()).toEqual([expect.objectContaining({ metaDataId: 1, waiting: 1, destination: 'Lab A', why: expect.stringContaining('put there before') })]);
      expect(await reprocess.resendDestination(channel!.id, old, 1, actor)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('not known to be for "Lab A"') } });
    });

    it('are known by the name, and not without one; newer ones by the number', async () => {
      const [old, other] = [await waiting(), await queue('Clinic B')];
      await upgraded({ names: { 1: 'Lab A' } });
      const newer = await queue('Clinic B');
      expect([await isForItsNumber(old), await isForItsNumber(other), await isForItsNumber(newer)]).toEqual([true, false, true]);

      await setOldNumbers({ names: { 1: 'Lab A' }, upTo: newer });
      expect(await isForItsNumber(newer)).toBe(false);
      await setOldNumbers({ names: { 1: 'Lab A' }, upTo: newer - 1 });
      expect(await isForItsNumber(newer)).toBe(true);

      await mods.pool.query('UPDATE connector_messages SET connector_name = NULL WHERE channel_id = $1', [channel!.id]);
      expect([await isForItsNumber(old), await isForItsNumber(newer)]).toEqual([false, true]);

      await mods.pool.query('UPDATE channels SET old_numbers = NULL WHERE id = $1', [channel!.id]);
      expect([await isForItsNumber(old), await isForItsNumber(newer)]).toEqual([false, true]);
    });

    it('go to the destinations they are routed to when recovery runs them again', async () => {
      const messageId = await waiting();
      const { MessageService } = mods;
      await mods.pool.query(`DELETE FROM connector_messages WHERE channel_id = $1 AND meta_data_id > 0`, [channel!.id]);
      await mods.pool.query(`UPDATE connector_messages SET status = 'RECEIVED' WHERE channel_id = $1`, [channel!.id]);
      await mods.pool.query('UPDATE messages SET processed = false WHERE channel_id = $1', [channel!.id]);
      unwrap(await MessageService.storeContent(channel!.id, messageId, 0, CONTENT_TYPE.RAW, 'order', 'RAW'));
      await upgraded({ names: {} });
      await save((named) => [{ ...named('Lab A'), name: 'Laboratory' }, named('Clinic B')]);

      await deploy();

      await vi.waitFor(async () => { expect([await status(messageId), (await received()).length]).toEqual(['SENT', 2]); }, WAIT);
      expect(await held()).toEqual([]);
    });

    it('are not sent to another destination by the first deploy of a channel that was saved then', async () => {
      const first = await waiting();
      await deploy();
      await vi.waitFor(async () => { expect(await status(first)).toBe('SENT'); }, WAIT);
      unwrap(await deployment.stop(channel!.id, actor));
      const messageId = await queue();
      await mods.pool.query(`DELETE FROM ${TABLE}`);
      // What a save did then when Lab A was removed, and what the migration recorded of it.
      await mods.pool.query('DELETE FROM channel_connectors WHERE channel_id = $1 AND meta_data_id = 1', [channel!.id]);
      await mods.pool.query('UPDATE channel_connectors SET id = gen_random_uuid(), meta_data_id = 1, position = 1 WHERE channel_id = $1', [channel!.id]);
      await mods.pool.query('UPDATE connector_messages SET number_kept = false WHERE channel_id = $1 AND message_id = $2', [channel!.id, first]);
      await setOldNumbers({ names: { 1: 'Lab A', 2: 'Clinic B' }, namesOnceDeployed: {} });
      expect([await isForItsNumber(first), await isForItsNumber(messageId)]).toEqual([true, true]);

      await deploy();
      await lookedTwice();

      expect(await received()).toEqual([]);
      expect(await status(messageId)).toBe('QUEUED');
      const { rows } = await mods.pool.query('SELECT old_numbers FROM channels WHERE id = $1', [channel!.id]);
      expect(rows).toEqual([{ old_numbers: { upTo: messageId, names: {} } }]);

      // Deployed again, nothing more is settled.
      const newer = await queue('Clinic B');
      unwrap(await deployment.stop(channel!.id, actor));
      await deploy();
      await vi.waitFor(async () => { expect(await status(newer)).toBe('SENT'); }, WAIT);
      expect(await received()).toEqual([{ partner: 'Clinic B', messageId: newer }]);
    });
  });

  it('are counted by destination, whichever numbers they have', async () => {
    const messageId = await waiting();
    await upgraded({ names: { 1: 'Lab A', 7: 'Y' } });
    const insert = (n: number, state: string): Promise<unknown> => mods.pool.query(
      'INSERT INTO connector_messages (channel_id, message_id, meta_data_id, connector_name, status, number_kept) VALUES ($1, $2, $3, $4, $5, $6)', [channel!.id, messageId, n, 'X', state, n === 4]);
    await insert(4, 'SENT');
    await insert(7, 'PENDING');
    await insert(2_000_000_000, 'QUEUED');

    expect(unwrap(await mods.MessageService.waitingByDestination(channel!.id))).toEqual([
      { metaDataId: 1, waiting: 1, notKnown: 0 }, { metaDataId: 7, waiting: 1, notKnown: 1 }, { metaDataId: 2_000_000_000, waiting: 1, notKnown: 1 },
    ]);
  });
});
