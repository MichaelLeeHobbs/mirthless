// Crash recovery with a real database destination (#390). A message whose variables were lost
// bound NULL in the partner's table and read SENT.

import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE, createChannelSchema, updateChannelSchema, type CreateChannelInput, type MessageStatus } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';
import { databaseDestination } from './_database-destination.js';

describeIntegration('What crash recovery sends (real Postgres, real database destination)', () => {
  const TABLE = 'itest_recovery_send';
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js');
  let engineMod: typeof import('../../src/engine.js');
  let channelId: string | null = null;

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    deployment = await import('../../src/services/deployment.service.js');
    engineMod = await import('../../src/engine.js');
  });

  beforeEach(async () => {
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await mods.pool.query(`CREATE TABLE ${TABLE} (message_id bigint, mrn text)`);
  });

  afterEach(async () => {
    if (channelId !== null) {
      await deployment.DeploymentService.stop(channelId, actor);
      await deployment.DeploymentService.undeploy(channelId, actor);
      channelId = null;
    }
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  afterAll(async () => {
    if (engineMod) await engineMod.getEngine().dispose();
    await mods?.pool.end();
  });

  function channelInput(destinations: readonly Record<string, unknown>[]): CreateChannelInput {
    return createChannelSchema.parse({
      name: `itest-390-${randomUUID()}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      responseMode: 'AUTO_AFTER_DESTINATIONS', destinations,
    });
  }

  /** A channel, and one message of it as a server stop leaves it: routed, and ready to send. */
  async function interrupted(queueMode: string, variables: Record<string, unknown> | null, query = `INSERT INTO ${TABLE} VALUES (\${messageId}::bigint, \${mrn})`): Promise<number> {
    const channel = unwrap(await mods.ChannelService.create(channelInput([databaseDestination('Partner', queueMode, query)]), actor));
    channelId = channel.id;
    const { MessageService } = mods;
    const { messageId } = unwrap(await MessageService.createMessage(channel.id, 'itest'));
    unwrap(await MessageService.createConnectorMessage(channel.id, messageId, 0, 'Source', 'TRANSFORMED'));
    unwrap(await MessageService.createConnectorMessage(channel.id, messageId, 1, 'Partner', 'RECEIVED'));
    unwrap(await MessageService.storeContent(channel.id, messageId, 1, CONTENT_TYPE.SENT, 'MSH|payload', 'RAW'));
    if (variables) unwrap(await MessageService.storeContent(channel.id, messageId, 1, CONTENT_TYPE.CHANNEL_MAP, JSON.stringify(variables), 'JSON'));
    return messageId;
  }

  async function recover(): Promise<void> {
    unwrap(await deployment.DeploymentService.deploy(channelId!, actor));
    if (engineMod.getEngine().getRuntime(channelId!)!.runtime.getState() !== 'STARTED') {
      unwrap(await deployment.DeploymentService.start(channelId!, actor));
    }
  }

  async function statuses(messageId: number): Promise<Record<number, MessageStatus>> {
    const rows = unwrap(await mods.MessageService.getConnectorMessages(channelId!, messageId));
    return Object.fromEntries(rows.map((r) => [r.metaDataId, r.status as MessageStatus]));
  }

  async function isProcessed(messageId: number): Promise<boolean> {
    return unwrap(await mods.MessageService.getUnprocessedMessages(channelId!, { afterId: 0, maxId: messageId }, 10)).length === 0;
  }

  async function partnerRows(): Promise<unknown[]> {
    return (await mods.pool.query(`SELECT message_id::int AS "messageId", mrn FROM ${TABLE}`)).rows;
  }

  const content = async (messageId: number, contentType: 6 | 11 | 13): Promise<string | null> =>
    unwrap(await mods.MessageService.loadContent(channelId!, messageId, 1, contentType));

  it('sends the variables that were stored', async () => {
    const messageId = await interrupted('ON_FAILURE', { mrn: '123' });

    await recover();
    await vi.waitFor(async () => { expect(await isProcessed(messageId)).toBe(true); }, 10_000);

    expect(await partnerRows()).toEqual([{ messageId, mrn: '123' }]);
    expect(await statuses(messageId)).toEqual({ 0: 'SENT', 1: 'SENT' });
    expect(await content(messageId, CONTENT_TYPE.RESPONSE)).toBe('1');
  });

  it('writes nothing to the partner when the query uses variables that were not kept, and says so', async () => {
    const messageId = await interrupted('NEVER', null);

    await recover();
    await vi.waitFor(async () => { expect(await isProcessed(messageId)).toBe(true); }, 10_000);

    expect(await partnerRows()).toEqual([]);
    expect(await statuses(messageId)).toEqual({ 0: 'ERROR', 1: 'ERROR' });
    expect(await content(messageId, CONTENT_TYPE.PROCESSING_ERROR)).toContain('(mrn)');
  });

  it('sends nothing to the destination that replaced the one it was prepared for', async () => {
    const insert = `INSERT INTO ${TABLE} VALUES (\${messageId}::bigint, \${content})`;
    const messageId = await interrupted('NEVER', null, insert);
    const { revision } = unwrap(await mods.ChannelService.getById(channelId!));
    const destinations = [{ ...databaseDestination('Partner', 'NEVER', insert), id: 'new' }];
    unwrap(await mods.ChannelService.update(channelId!, updateChannelSchema.parse({ revision, enabled: true, destinations }), actor));

    await recover();
    await vi.waitFor(async () => { expect(await isProcessed(messageId)).toBe(true); }, 10_000);

    expect(await partnerRows()).toEqual([]);
    expect(await statuses(messageId)).toEqual({ 0: 'ERROR', 1: 'ERROR' });
    expect(await content(messageId, CONTENT_TYPE.PROCESSING_ERROR)).toContain('no longer has the destination');
  });

  it('sends without variables when the query uses none', async () => {
    const messageId = await interrupted('NEVER', null, `INSERT INTO ${TABLE} VALUES (\${messageId}::bigint, \${content})`);

    await recover();
    await vi.waitFor(async () => { expect(await isProcessed(messageId)).toBe(true); }, 10_000);

    expect(await partnerRows()).toEqual([{ messageId, mrn: 'MSH|payload' }]);
    expect(await statuses(messageId)).toEqual({ 0: 'SENT', 1: 'SENT' });
  });

  it('leaves a message on the queue, closed and with its reason, when the partner refuses it, and the queue delivers it', async () => {
    await mods.pool.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT refuses CHECK (mrn <> '123')`);
    const messageId = await interrupted('ON_FAILURE', { mrn: '123' });

    await recover();
    await vi.waitFor(async () => { expect(await isProcessed(messageId)).toBe(true); }, 10_000);
    expect((await statuses(messageId))[0]).toBe('SENT');
    expect(['QUEUED', 'PENDING']).toContain((await statuses(messageId))[1]);
    expect(await content(messageId, CONTENT_TYPE.ERROR)).toContain('refuses');

    await mods.pool.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT refuses`);
    await vi.waitFor(async () => { expect(await statuses(messageId)).toEqual({ 0: 'SENT', 1: 'SENT' }); }, 15_000);
    expect(await partnerRows()).toEqual([{ messageId, mrn: '123' }]);
    expect(await content(messageId, CONTENT_TYPE.ERROR)).toBeNull();
    expect(unwrap(await mods.MessageService.isFullyDelivered(channelId!, messageId))).toBe(true);
  });

  it('puts a message on the queue of a destination that always queues', async () => {
    const messageId = await interrupted('ALWAYS', { mrn: '123' });

    await recover();
    await vi.waitFor(async () => { expect(await statuses(messageId)).toEqual({ 0: 'SENT', 1: 'SENT' }); }, 15_000);

    expect(await partnerRows()).toEqual([{ messageId, mrn: '123' }]);
  });
});
