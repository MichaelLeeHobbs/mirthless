// A send to another channel that a server stop interrupts (#401). The sender's send waits for the
// target's whole pipeline, so a stop leaves both messages open; the next start ran the target's
// message and sent to the target again, which delivered twice.

import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE, createChannelSchema } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, WAIT, type ServerModules, type TestActor } from './_setup.js';
import { databaseDestination } from './_database-destination.js';
import { START_TIMEOUT_MS, startAndDie, WAITS_FOR_THE_LOCK } from './support/killed-server.js';

describeIntegration('A send to another channel that a server stop interrupts (real Postgres, killed processes)', () => {
  const TABLE = 'itest_hand_off';
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js');
  let engineMod: typeof import('../../src/engine.js');
  let shutdown: typeof import('../../src/lib/shutdown.js');
  let dependencies: typeof import('../../src/services/channel-dependency.service.js');
  let reprocess: typeof import('../../src/services/message-reprocess.service.js');
  const created: string[] = [];
  const silent = { error: (): void => {} };

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    deployment = await import('../../src/services/deployment.service.js');
    engineMod = await import('../../src/engine.js');
    shutdown = await import('../../src/lib/shutdown.js');
    dependencies = await import('../../src/services/channel-dependency.service.js');
    reprocess = await import('../../src/services/message-reprocess.service.js');
  });

  beforeEach(async () => {
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await mods.pool.query(`CREATE TABLE ${TABLE} (message_id bigint, content text)`);
  });

  afterEach(async () => {
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    for (const id of created.splice(0)) await mods.ChannelService.setEnabled(id, false);
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  afterAll(async () => {
    if (engineMod) await engineMod.getEngine().dispose();
    await mods?.pool.end();
  });

  interface Pair { readonly sender: string; readonly target: string }
  interface PairOptions {
    /** Where the target waits while the test holds the lock. */
    readonly waitsIn?: 'transformer' | 'postprocessor' | 'nowhere';
    readonly senderQueue?: string;
    /** Run after the wait in the target's transformer. */
    readonly then?: string;
    readonly targetStorage?: string;
  }

  /** A target that writes each message it delivers to the table, and a sender that hands its messages to it, both deployed once and the server stopped. */
  async function pair({ waitsIn = 'transformer', senderQueue = 'NEVER', then = '', targetStorage = 'DEVELOPMENT' }: PairOptions = {}): Promise<Pair> {
    const common = { enabled: true, properties: { initialState: 'STARTED' }, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'AUTO_AFTER_DESTINATIONS' } as const;
    const target = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      ...common, name: `itest-401-target-${randomUUID()}`, properties: { ...common.properties, messageStorageMode: targetStorage },
      sourceConnectorType: 'CHANNEL', sourceConnectorProperties: {},
      ...(waitsIn === 'transformer' ? { transformers: [{ inboundDataType: 'RAW', outboundDataType: 'RAW', steps: [{ type: 'JAVASCRIPT', script: `${WAITS_FOR_THE_LOCK} ${then}` }] }] } : {}),
      ...(waitsIn === 'postprocessor' ? { scripts: { postprocessor: WAITS_FOR_THE_LOCK } } : {}),
      destinations: [databaseDestination('Partner', 'NEVER', `INSERT INTO ${TABLE} VALUES (\${messageId}::bigint, \${content})`)],
    }), actor));
    created.push(target.id);
    const sender = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      ...common, name: `itest-401-sender-${randomUUID()}`,
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      destinations: [{ name: 'To target', connectorType: 'CHANNEL', queueMode: senderQueue, retryIntervalMs: 100, properties: { targetChannelId: target.id } }],
    }), actor));
    created.push(sender.id);
    // The target starts first at every start, as an installation that routes to a channel sets it up.
    unwrap(await dependencies.ChannelDependencyService.setDependencies(sender.id, { dependsOnChannelIds: [target.id] }));
    for (const id of [target.id, sender.id]) unwrap(await deployment.DeploymentService.deploy(id, actor));
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    return { sender: sender.id, target: target.id };
  }

  /** A message the sender had received when the server stopped: its start runs it again and hands it on. */
  async function received(channelId: string): Promise<number> {
    const { messageId } = unwrap(await mods.MessageService.initializeMessage(channelId, 'itest', 'Source', [
      { metaDataId: 0, contentType: CONTENT_TYPE.RAW, content: 'order', dataType: 'RAW' },
      { metaDataId: 0, contentType: CONTENT_TYPE.SOURCE_MAP, content: '{}', dataType: 'JSON' },
    ]));
    return Number(messageId);
  }

  async function restart(): Promise<void> {
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    unwrap(await deployment.DeploymentService.autoDeployChannels());
  }

  async function messagesOf(channelId: string): Promise<{ readonly id: number; readonly processed: boolean }[]> {
    return (await mods.pool.query(`SELECT id::int, processed FROM messages WHERE channel_id = $1 ORDER BY id`, [channelId])).rows;
  }

  async function statusesOf(channelId: string): Promise<unknown[]> {
    return (await mods.pool.query(
      `SELECT message_id::int AS message, meta_data_id AS connector, status FROM connector_messages WHERE channel_id = $1 ORDER BY 1, 2`, [channelId],
    )).rows;
  }

  async function finished({ sender, target }: Pair): Promise<void> {
    await vi.waitFor(async () => {
      const all = [...await messagesOf(sender), ...await messagesOf(target)];
      expect(all).not.toContainEqual(expect.objectContaining({ processed: false }));
    }, WAIT);
  }

  async function delivered(): Promise<unknown[]> {
    return (await mods.pool.query(`SELECT message_id::int AS "messageId", content FROM ${TABLE} ORDER BY 1`)).rows;
  }

  const ROUTED = ['TRANSFORMED', 'RECEIVED'] as const;

  /** The target holds one message from the sender, unfinished, and the sender's send to it is open. */
  async function stoppedInTheTarget(found: Pair, [source, destination]: readonly [string, string]): Promise<number> {
    const [handed, ...more] = await messagesOf(found.target);
    expect(more).toEqual([]);
    expect(handed).toEqual({ id: expect.any(Number), processed: false });
    const [message] = await messagesOf(found.sender);
    expect(await statusesOf(found.sender)).toEqual([
      { message: message!.id, connector: 0, status: source }, { message: message!.id, connector: 1, status: destination },
    ]);
    return handed!.id;
  }

  it('delivers once when the server stopped while the target ran its scripts', { timeout: 3 * START_TIMEOUT_MS }, async () => {
    const found = await pair();
    const messageId = await received(found.sender);
    await startAndDie(mods.pool);
    const handed = await stoppedInTheTarget(found, ROUTED);

    await restart();
    await finished(found);

    expect(await delivered()).toEqual([{ messageId: handed, content: 'order' }]);
    expect(await messagesOf(found.target)).toEqual([{ id: handed, processed: true }]);
    expect(await statusesOf(found.sender)).toEqual([
      { message: messageId, connector: 0, status: 'SENT' }, { message: messageId, connector: 1, status: 'SENT' },
    ]);
    expect(unwrap(await mods.MessageService.loadContent(found.sender, messageId, 1, CONTENT_TYPE.RESPONSE))).toBe(`messageId=${String(handed)}`);
  });

  it('runs the target message again with its source map, though its storage mode keeps none', { timeout: 3 * START_TIMEOUT_MS }, async () => {
    const found = await pair({ targetStorage: 'PRODUCTION', then: "msg = String($s('sourceMessageId')) + ':' + String(msg);" });
    const messageId = await received(found.sender);
    await startAndDie(mods.pool);
    const handed = await stoppedInTheTarget(found, ROUTED);

    await restart();
    await finished(found);

    expect(await delivered()).toEqual([{ messageId: handed, content: `${String(messageId)}:order` }]);
  });

  it('delivers once when the server stopped after the target delivered and before it finished', { timeout: 3 * START_TIMEOUT_MS }, async () => {
    const found = await pair({ waitsIn: 'postprocessor' });
    await received(found.sender);
    await startAndDie(mods.pool);
    const handed = await stoppedInTheTarget(found, ROUTED);
    expect(await delivered()).toEqual([{ messageId: handed, content: 'order' }]);

    await restart();
    await finished(found);

    expect(await delivered()).toEqual([{ messageId: handed, content: 'order' }]);
    expect(await messagesOf(found.target)).toHaveLength(1);
  });

  it('delivers once when the sender queues and the server stopped while the queue sent it', { timeout: 3 * START_TIMEOUT_MS }, async () => {
    const found = await pair({ senderQueue: 'ALWAYS' });
    await received(found.sender);
    await startAndDie(mods.pool);
    const handed = await stoppedInTheTarget(found, ['SENT', 'PENDING']);

    await restart();
    await finished(found);
    await vi.waitFor(async () => { expect(await statusesOf(found.sender)).toContainEqual(expect.objectContaining({ connector: 1, status: 'SENT' })); }, WAIT);

    expect(await delivered()).toEqual([{ messageId: handed, content: 'order' }]);
    expect(await messagesOf(found.target)).toHaveLength(1);
  });

  it('reads ERROR when the target failed the message it had, and hands it on no second time, though the sender queues on failure', { timeout: 3 * START_TIMEOUT_MS }, async () => {
    const found = await pair({ senderQueue: 'ON_FAILURE' });
    const messageId = await received(found.sender);
    await startAndDie(mods.pool);
    const handed = await stoppedInTheTarget(found, ROUTED);
    await mods.pool.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT refuses CHECK (message_id <> ${String(handed)})`);

    await restart();
    await finished(found);

    expect(await delivered()).toEqual([]);
    expect(await messagesOf(found.target)).toEqual([{ id: handed, processed: true }]);
    expect(await statusesOf(found.sender)).toEqual([
      { message: messageId, connector: 0, status: 'ERROR' }, { message: messageId, connector: 1, status: 'ERROR' },
    ]);
    expect(unwrap(await mods.MessageService.loadContent(found.sender, messageId, 1, CONTENT_TYPE.ERROR))).toContain(`recorded message ${String(handed)}, from a send a server stop interrupted`);
  });

  it('hands it on again when the target\'s message is gone', { timeout: 3 * START_TIMEOUT_MS }, async () => {
    const found = await pair();
    await received(found.sender);
    await startAndDie(mods.pool);
    const handed = await stoppedInTheTarget(found, ROUTED);
    for (const table of ['message_content', 'connector_messages']) await mods.pool.query(`DELETE FROM ${table} WHERE channel_id = $1`, [found.target]);
    await mods.pool.query('DELETE FROM messages WHERE channel_id = $1', [found.target]);

    await restart();
    await finished(found);

    const [again, ...more] = await messagesOf(found.target);
    expect(more).toEqual([]);
    expect(again!.id).not.toBe(handed);
    expect(await delivered()).toEqual([{ messageId: again!.id, content: 'order' }]);
  });

  it('hands a message on again when a person resends it', async () => {
    const found = await pair({ waitsIn: 'nowhere', senderQueue: 'ON_FAILURE' });
    await restart();
    const { messageId } = unwrap(await deployment.DeploymentService.sendMessage(found.sender, 'order'));
    await finished(found);
    // As an interrupted send would have left it: the queue would take the target's message as this send.
    const [handed] = await messagesOf(found.target);
    unwrap(await mods.MessageService.storeContent(found.sender, messageId, 1, CONTENT_TYPE.HAND_OFF, JSON.stringify({ channelId: found.target, messageId: handed!.id }), 'JSON'));

    unwrap(await reprocess.MessageReprocessService.resendDestination(found.sender, messageId, 1));
    await vi.waitFor(async () => { expect(await delivered()).toHaveLength(2); }, WAIT);
    await finished(found);

    expect(await messagesOf(found.target)).toHaveLength(2);
  });

  it('hands a message on at a retry once the target runs', async () => {
    const found = await pair({ waitsIn: 'nowhere', senderQueue: 'ON_FAILURE' });
    await restart();
    unwrap(await deployment.DeploymentService.stop(found.target, actor));
    unwrap(await deployment.DeploymentService.sendMessage(found.sender, 'order'));
    await vi.waitFor(async () => { expect(await statusesOf(found.sender)).toContainEqual(expect.objectContaining({ connector: 1, status: 'QUEUED' })); }, WAIT);

    unwrap(await deployment.DeploymentService.start(found.target, actor));
    await vi.waitFor(async () => { expect(await delivered()).toHaveLength(1); }, WAIT);
    await finished(found);
    expect(await messagesOf(found.target)).toHaveLength(1);
  });
});
