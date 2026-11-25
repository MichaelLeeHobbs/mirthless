// Deleting a message while something still works on it left its content behind, where neither the
// pruner nor the browser finds it, and could lose a queued delivery (#403, D-372).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE, createChannelSchema, type MessageStatus } from '@galvanigraph/core-models';
import type { PoolClient } from 'pg';
import { adminActor, describeIntegration, loadServerModules, unwrap, WAIT, waitForBlocked, type ServerModules, type TestActor } from './_setup.js';
import { databaseDestination } from './_database-destination.js';

describeIntegration('Deleting a message that is still worked on (real Postgres, real database destination)', () => {
  const TABLE = 'itest_delete_in_flight';
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js').DeploymentService;
  let reprocess: typeof import('../../src/services/message-reprocess.service.js').MessageReprocessService;
  let engineMod: typeof import('../../src/engine.js');
  let channelId: string;
  const holders: PoolClient[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    ({ DeploymentService: deployment } = await import('../../src/services/deployment.service.js'));
    ({ MessageReprocessService: reprocess } = await import('../../src/services/message-reprocess.service.js'));
    engineMod = await import('../../src/engine.js');
  });

  beforeEach(async () => {
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await mods.pool.query(`CREATE TABLE ${TABLE} (content text)`);
  });

  afterEach(async () => {
    for (const holder of [...holders]) await end(holder, 'ROLLBACK');
    if (engineMod.getEngine().getRuntime(channelId)) {
      await deployment.stop(channelId, actor);
      await deployment.undeploy(channelId, actor);
    }
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  afterAll(async () => {
    if (engineMod) await engineMod.getEngine().dispose();
    await mods?.pool.end();
  });

  async function createChannel(queueMode = 'NEVER'): Promise<void> {
    channelId = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-403-${randomUUID()}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      responseMode: 'AUTO_AFTER_DESTINATIONS', destinations: [databaseDestination('Partner', queueMode, `INSERT INTO ${TABLE} VALUES (\${content})`)],
    }), actor)).id;
  }

  async function running(queueMode = 'NEVER'): Promise<void> {
    await createChannel(queueMode);
    unwrap(await deployment.deploy(channelId, actor));
    if (engineMod.getEngine().getRuntime(channelId)!.runtime.getState() !== 'STARTED') unwrap(await deployment.start(channelId, actor));
  }

  /** Runs it in a transaction that stays open until `end`. */
  async function hold(statement: string, params: string[] = []): Promise<PoolClient> {
    const holder = await mods.pool.connect();
    holders.push(holder);
    await holder.query('BEGIN');
    await holder.query(statement, params);
    return holder;
  }

  async function end(holder: PoolClient, how: 'COMMIT' | 'ROLLBACK'): Promise<void> {
    holders.splice(holders.indexOf(holder), 1);
    await holder.query(how);
    holder.release();
  }

  const partnerDoesNotAnswer = (): Promise<PoolClient> => hold(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`);
  const letAnswer = (partner: PoolClient): Promise<void> => end(partner, 'ROLLBACK');
  const beingSent = (): Promise<void> => waitForBlocked(mods.pool, `INSERT INTO ${TABLE}`);
  const send = (content: string): Promise<unknown> => engineMod.getEngine().sendMessage(channelId, content);

  async function newestId(): Promise<number> {
    return unwrap(await mods.MessageService.getLatestMessageId(channelId));
  }

  async function state(messageId: number): Promise<{ processed: boolean | undefined; statuses: Record<number, MessageStatus> }> {
    const { rows } = await mods.pool.query<{ processed: boolean }>('SELECT processed FROM messages WHERE channel_id = $1 AND id = $2', [channelId, messageId]);
    const connectors = unwrap(await mods.MessageService.getConnectorMessages(channelId, messageId));
    return { processed: rows[0]?.processed, statuses: Object.fromEntries(connectors.map((c) => [c.metaDataId, c.status as MessageStatus])) };
  }

  const DELIVERED = { processed: true, statuses: { 0: 'SENT', 1: 'SENT' } };
  const GONE = { processed: undefined, statuses: {} };

  /** Rows of messages that are not there. */
  async function leftBehind(): Promise<Record<string, number>> {
    const found: Record<string, number> = {};
    for (const table of ['connector_messages', 'message_content', 'message_custom_metadata', 'message_attachments']) {
      const { rows } = await mods.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} t WHERE channel_id = $1 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = t.channel_id AND m.id = t.message_id)`, [channelId]);
      if (rows[0]!.n > 0) found[table] = rows[0]!.n;
    }
    return found;
  }

  async function received(): Promise<string[]> {
    return (await mods.pool.query<{ content: string }>(`SELECT content FROM ${TABLE} ORDER BY content`)).rows.map((r) => r.content);
  }

  async function auditEvents(): Promise<unknown[]> {
    const { rows } = await mods.pool.query(
      `SELECT name, level, user_id AS "userId", attributes FROM events WHERE channel_id = $1 AND name IN ('MESSAGE_DELETED', 'MESSAGES_DELETED') ORDER BY id`, [channelId]);
    return rows;
  }

  const refusal = { ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('still being processed') as string } };

  describe('while a destination is being sent to', () => {
    it.each([
      ['alone', (id: number): Promise<unknown> => reprocess.deleteMessage(channelId, id, actor)],
      ['in bulk', (id: number): Promise<unknown> => reprocess.bulkDelete(channelId, [id], actor)],
    ])('deleted %s, it leaves nothing behind: it is refused, delivered and recorded', async (_how, remove) => {
      await running();
      const partner = await partnerDoesNotAnswer();
      const sending = send('PHI');
      await beingSent();
      const messageId = await newestId();

      const refused = await remove(messageId);
      await letAnswer(partner);
      await sending;

      expect(await leftBehind()).toEqual({});
      expect(refused).toMatchObject(refusal);
      expect(await state(messageId)).toEqual(DELIVERED);
      expect(await received()).toEqual(['PHI']);
      expect(await auditEvents()).toEqual([]);

      expect(await remove(messageId)).toMatchObject({ ok: true });
      expect(await state(messageId)).toEqual(GONE);
      expect(await leftBehind()).toEqual({});
    });

    it('the others of a bulk delete are deleted, and it is named', async () => {
      await running();
      await send('finished');
      const finished = await newestId();
      const partner = await partnerDoesNotAnswer();
      const sending = send('PHI');
      await beingSent();
      const open = await newestId();

      expect(unwrap(await reprocess.bulkDelete(channelId, [finished, open], actor))).toEqual({ deletedCount: 1, refusedIds: [open] });

      await letAnswer(partner);
      await sending;
      expect(await state(finished)).toEqual(GONE);
      expect(await state(open)).toEqual(DELIVERED);
      expect(await leftBehind()).toEqual({});
    });

    it('it is refused after a halt and an undeploy too, until what was under way has ended', async () => {
      await running();
      const partner = await partnerDoesNotAnswer();
      const sending = send('PHI');
      await beingSent();
      const messageId = await newestId();
      const statistics = await hold('LOCK TABLE message_statistics IN SHARE MODE');
      await letAnswer(partner);
      await waitForBlocked(mods.pool, '%INSERT INTO message_statistics');
      unwrap(await deployment.halt(channelId, actor));
      const refusedHalted = await reprocess.bulkDelete(channelId, [messageId], actor);
      unwrap(await deployment.undeploy(channelId, actor));

      const refused = await reprocess.bulkDelete(channelId, [messageId], actor);
      await end(statistics, 'ROLLBACK');
      await sending;

      expect([refusedHalted, refused]).toMatchObject([refusal, refusal]);
      expect(await state(messageId)).toEqual(DELIVERED);
      expect(unwrap(await reprocess.bulkDelete(channelId, [messageId], actor))).toEqual({ deletedCount: 1, refusedIds: [] });
      expect(await leftBehind()).toEqual({});
    });
  });

  describe('on the queue of a destination', () => {
    it('it is refused while the queue sends it, and can be deleted while it waits, after which it is not sent', async () => {
      await running('ALWAYS');
      const partner = await partnerDoesNotAnswer();
      await send('first');
      const first = await newestId();
      await beingSent();
      await send('second');
      const second = await newestId();
      expect([await state(first), await state(second)]).toEqual([
        { processed: true, statuses: { 0: 'SENT', 1: 'PENDING' } }, { processed: true, statuses: { 0: 'SENT', 1: 'QUEUED' } },
      ]);

      expect(await reprocess.resendDestination(channelId, first, 1, actor)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('being sent to "Partner" from its queue') as string } });
      const refused = await reprocess.bulkDelete(channelId, [first], actor);
      expect(unwrap(await reprocess.bulkDelete(channelId, [second], actor))).toEqual({ deletedCount: 1, refusedIds: [] });
      await letAnswer(partner);

      await vi.waitFor(async () => { expect(await state(first)).toEqual(DELIVERED); }, WAIT);
      expect(refused).toMatchObject(refusal);
      expect(await received()).toEqual(['first']);
      expect(await leftBehind()).toEqual({});
      await vi.waitFor(async () => {
        expect(await auditEvents()).toEqual([
          { name: 'MESSAGES_DELETED', level: 'WARN', userId: actor.userId, attributes: { deletedCount: 1, unfinishedIds: [second] } },
        ]);
      }, WAIT);
    });

    it('it is refused when the queue takes it at the same moment', async () => {
      await running('ALWAYS');
      const { MessageService } = mods;
      const { messageId } = unwrap(await MessageService.createMessage(channelId, 'itest'));
      // Not QUEUED: the channel's own queue would take it first.
      unwrap(await MessageService.createConnectorMessage(channelId, messageId, 1, 'Partner', 'ERROR'));
      unwrap(await MessageService.markProcessed(channelId, messageId));
      const claim = await hold(`UPDATE connector_messages SET status = 'PENDING' WHERE channel_id = $1`, [channelId]);

      expect(await reprocess.deleteMessage(channelId, messageId, actor)).toMatchObject(refusal);
      await end(claim, 'COMMIT');

      expect(await reprocess.deleteMessage(channelId, messageId, actor)).toMatchObject(refusal);
      expect(await state(messageId)).toEqual({ processed: true, statuses: { 1: 'PENDING' } });
    });

    it('a resend of one that is deleted meanwhile says so', async () => {
      await running('ALWAYS');
      await send('PHI');
      const messageId = await newestId();
      await vi.waitFor(async () => { expect(await state(messageId)).toEqual(DELIVERED); }, WAIT);
      const deletion = await hold('DELETE FROM connector_messages WHERE channel_id = $1', [channelId]);

      const resending = reprocess.resendDestination(channelId, messageId, 1, actor);
      await waitForBlocked(mods.pool, 'update "connector_messages"');
      await end(deletion, 'COMMIT');

      expect(await resending).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('was not resent') as string } });
    });
  });

  describe('that will never finish', () => {
    it.each([
      ['RECEIVED', 'stopped'],
      ['PENDING', 'stopped'],
      ['PENDING', 'undeployed'],
    ] as const)('%s, it can be deleted once its channel is %s, and the record names it', async (destination, once) => {
      await running();
      const { MessageService } = mods;
      const { messageId } = unwrap(await MessageService.createMessage(channelId, 'itest'));
      unwrap(await MessageService.createConnectorMessage(channelId, messageId, 0, 'Source', 'TRANSFORMED'));
      unwrap(await MessageService.createConnectorMessage(channelId, messageId, 1, 'Partner', destination));
      unwrap(await MessageService.storeContent(channelId, messageId, 1, CONTENT_TYPE.SENT, 'PHI', 'RAW'));

      expect(await reprocess.deleteMessage(channelId, messageId, actor)).toMatchObject({
        ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('stop the channel first') as string },
      });
      unwrap(await deployment.stop(channelId, actor));
      if (once === 'undeployed') unwrap(await deployment.undeploy(channelId, actor));
      unwrap(await reprocess.deleteMessage(channelId, messageId, actor));

      expect(await state(messageId)).toEqual(GONE);
      expect(await leftBehind()).toEqual({});
      await vi.waitFor(async () => {
        expect(await auditEvents()).toEqual([
          { name: 'MESSAGE_DELETED', level: 'WARN', userId: actor.userId, attributes: { messageId, unfinished: true } },
        ]);
      }, WAIT);
    });
  });

  it('a queue and a status change of a message that is gone fail instead of reading as done', async () => {
    await createChannel();
    const { MessageService } = mods;
    const gone = { ok: false, error: { code: 'NOT_FOUND' } };

    expect(await MessageService.enqueue(channelId, 1, 1)).toMatchObject(gone);
    expect(await MessageService.updateConnectorMessageStatus(channelId, 1, 0, 'TRANSFORMED')).toMatchObject(gone);
  });
});
