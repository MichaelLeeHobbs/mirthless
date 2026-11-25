// A server that dies while crash recovery runs a message again (#401). Each of those starts is a
// process of its own, killed while the message's script waits for a table this test holds locked.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { CONTENT_TYPE, createChannelSchema } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, waitForBlocked, type ServerModules, type TestActor } from './_setup.js';

const CHILD = fileURLToPath(new URL('./support/starting-server-child.ts', import.meta.url));
const SERVER = fileURLToPath(new URL('../..', import.meta.url));

describeIntegration('A message interrupted again and again (real Postgres, killed processes)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js');
  let engineMod: typeof import('../../src/engine.js');
  let shutdown: typeof import('../../src/lib/shutdown.js');
  const created: string[] = [];
  const silent = { error: (): void => {} };

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    deployment = await import('../../src/services/deployment.service.js');
    engineMod = await import('../../src/engine.js');
    shutdown = await import('../../src/lib/shutdown.js');
  });

  afterEach(async () => {
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    for (const id of created.splice(0)) await mods.ChannelService.setEnabled(id, false);
  });

  afterAll(async () => {
    if (engineMod) await engineMod.getEngine().dispose();
    await mods?.pool.end();
  });

  /** A deployed channel whose script reads the resources table, with the server stopped. */
  async function stoppedChannel(): Promise<{ readonly id: string; readonly name: string }> {
    const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-401-${randomUUID()}`, enabled: true, properties: { initialState: 'STARTED' },
      inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      responseMode: 'AUTO_AFTER_DESTINATIONS',
      transformers: [{ inboundDataType: 'RAW', outboundDataType: 'RAW', steps: [{ type: 'JAVASCRIPT', script: "try { await getResource('none'); } catch (e) { /* it has none */ } msg = 'ran:' + String(msg);" }] }],
      destinations: [{ name: 'Partner', connectorType: 'JAVASCRIPT', properties: { script: "return 'ok';" } }],
    }), actor));
    created.push(channel.id);
    unwrap(await deployment.DeploymentService.deploy(channel.id, actor));
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    return { id: channel.id, name: channel.name };
  }

  /** A message the server was running the source's scripts on when it stopped. */
  async function unfinishedMessage(channelId: string): Promise<number> {
    const { messageId } = unwrap(await mods.MessageService.initializeMessage(channelId, 'itest', 'Source', [
      { metaDataId: 0, contentType: CONTENT_TYPE.RAW, content: 'order', dataType: 'RAW' },
      { metaDataId: 0, contentType: CONTENT_TYPE.SOURCE_MAP, content: '{}', dataType: 'JSON' },
    ]));
    return Number(messageId);
  }

  /** Start a server and kill it once `channelId`'s message is running again. */
  async function startAndDie(): Promise<void> {
    const locker = await mods.pool.connect();
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE resources IN ACCESS EXCLUSIVE MODE');
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD], { cwd: SERVER, stdio: 'ignore' });
    try {
      await waitForBlocked(mods.pool, 'select %"resources"');
    } finally {
      const gone = once(child, 'exit');
      child.kill('SIGKILL');
      await gone;
      await locker.query('ROLLBACK');
      locker.release();
    }
  }

  async function restart(): Promise<string | null> {
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    const result = await deployment.DeploymentService.autoDeployChannels();
    return result.ok ? null : result.error.message;
  }

  async function messagesOf(channelId: string): Promise<unknown[]> {
    return (await mods.pool.query(`SELECT id::int, processed FROM messages WHERE channel_id = $1 ORDER BY id`, [channelId])).rows;
  }

  async function connectorsOf(channelId: string): Promise<unknown[]> {
    return (await mods.pool.query(
      `SELECT message_id::int AS message, meta_data_id AS connector, status FROM connector_messages WHERE channel_id = $1 ORDER BY 1, 2`, [channelId],
    )).rows;
  }

  it.each([1, 3])('is delivered once, as the same message, after %i more', { timeout: 120_000 }, async (more) => {
    const { id } = await stoppedChannel();
    const messageId = await unfinishedMessage(id);

    for (let i = 0; i < more; i += 1) await startAndDie();
    expect(await restart()).toBeNull();

    await vi.waitFor(async () => { expect(await messagesOf(id)).not.toContainEqual(expect.objectContaining({ processed: false })); }, 20_000);
    expect(await connectorsOf(id)).toEqual([{ message: messageId, connector: 0, status: 'SENT' }, { message: messageId, connector: 1, status: 'SENT' }]);
    expect(unwrap(await mods.MessageService.loadContent(id, messageId, 1, CONTENT_TYPE.SENT))).toBe('ran:order');
    const { rows } = await mods.pool.query('SELECT received::int, sent::int, errored::int FROM message_statistics WHERE channel_id = $1 AND meta_data_id = 0', [id]);
    expect(rows.reduce((sum: Record<string, number>, r: Record<string, number>) => ({
      received: sum['received']! + r['received']!, sent: sum['sent']! + r['sent']!, errored: sum['errored']! + r['errored']!,
    }), { received: 0, sent: 0, errored: 0 })).toEqual({ received: 1, sent: 1, errored: 0 });
  });

  describe('put back as it was received', () => {
    const { RAW, SOURCE_MAP, TRANSFORMED, SENT, PROCESSING_ERROR } = CONTENT_TYPE;
    const channelId = randomUUID();

    async function contentsOf(messageId: number): Promise<unknown[]> {
      return (await mods.pool.query('SELECT meta_data_id AS c, content_type AS t FROM message_content WHERE message_id = $1 ORDER BY 1, 2', [messageId])).rows;
    }

    /** Stopped once its destinations were recorded, with what a first run may leave behind. */
    async function recorded(): Promise<number> {
      const { MessageService } = mods;
      const messageId = await unfinishedMessage(channelId);
      unwrap(await MessageService.storeContent(channelId, messageId, 0, TRANSFORMED, 'old', 'RAW'));
      unwrap(await MessageService.storeContent(channelId, messageId, 0, PROCESSING_ERROR, 'old', 'TEXT'));
      unwrap(await MessageService.storeCustomMetadata(channelId, messageId, 0, { mrn: 'old' }));
      unwrap(await MessageService.createConnectorMessage(channelId, messageId, 1, 'Partner', 'RECEIVED'));
      return messageId;
    }

    const statuses = async (messageId: number): Promise<unknown[]> =>
      unwrap(await mods.MessageService.getConnectorMessages(channelId, messageId)).map((r) => [r.metaDataId, r.status]);

    it('keeps what was received and its correlation, and nothing a first run added, for that message only', async () => {
      const other = await recorded();
      const messageId = await recorded();
      const { rows: [row] } = await mods.pool.query('SELECT correlation_id AS c FROM messages WHERE id = $1', [messageId]);

      expect(unwrap(await mods.MessageService.resetToReceived(channelId, messageId))).toEqual({ messageId, correlationId: (row as { c: string }).c });

      expect(await statuses(messageId)).toEqual([[0, 'RECEIVED']]);
      expect(await contentsOf(messageId)).toEqual([{ c: 0, t: RAW }, { c: 0, t: SOURCE_MAP }]);
      const metadata = async (id: number): Promise<number> => (await mods.pool.query('SELECT 1 FROM message_custom_metadata WHERE message_id = $1', [id])).rows.length;
      expect([await metadata(messageId), await metadata(other)]).toEqual([0, 1]);
      expect(await contentsOf(other)).toHaveLength(4);
      expect(await statuses(other)).toHaveLength(2);
    });

    it('takes a source that was transformed and had no destinations', async () => {
      const messageId = await unfinishedMessage(channelId);
      unwrap(await mods.MessageService.updateConnectorMessageStatus(channelId, messageId, 0, 'TRANSFORMED'));

      unwrap(await mods.MessageService.resetToReceived(channelId, messageId));

      expect(await statuses(messageId)).toEqual([[0, 'RECEIVED']]);
    });

    it.each<[string, (messageId: number) => Promise<unknown>]>([
      ['a destination has been sent to', async (id) => mods.MessageService.updateConnectorMessageStatus(channelId, id, 1, 'SENT')],
      ['a destination is queued', async (id) => mods.MessageService.updateConnectorMessageStatus(channelId, id, 1, 'QUEUED')],
      ['its source has failed', async (id) => mods.MessageService.updateConnectorMessageStatus(channelId, id, 0, 'ERROR')],
      ['it is finished', async (id) => mods.MessageService.markProcessed(channelId, id)],
    ])('is refused, with nothing changed, when %s', async (_why, change) => {
      const messageId = await recorded();
      unwrap(await mods.MessageService.storeContent(channelId, messageId, 1, SENT, 'payload', 'RAW'));
      await change(messageId);
      const before = { contents: await contentsOf(messageId), statuses: await statuses(messageId) };

      const reset = await mods.MessageService.resetToReceived(channelId, messageId);

      expect(reset.ok).toBe(false);
      expect({ contents: await contentsOf(messageId), statuses: await statuses(messageId) }).toEqual(before);
    });

    it('is refused for a message that is gone', async () => {
      expect((await mods.MessageService.resetToReceived(channelId, 9_999_999)).ok).toBe(false);
    });
  });
});
