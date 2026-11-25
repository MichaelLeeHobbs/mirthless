// What the server logs when a statement fails (D-347). It logged the statement's
// parameters: connector passwords and message content. The last tests also cover
// what becomes of a message whose answer cannot be stored, or holds U+0000 (#404).
// Needs CONTENT_ENCRYPTION_KEY.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { CONTENT_TYPE, createChannelSchema } from '@galvanigraph/core-models';
import {
  adminActor, apiCall, closeServer, describeIntegration, listen, loadServerModules, unwrap, userWithRole, WAIT,
  type ServerModules, type TestActor,
} from './_setup.js';

const NUL = String.fromCharCode(0);

describeIntegration('the log of a failed statement (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let token: string;
  let server: Server;
  let partner: Server;
  let base: string;
  let partnerUrl: string;
  let logged = '';
  let requests = 0;
  let engineMod: typeof import('../../src/engine.js');
  let deployment: typeof import('../../src/services/deployment.service.js');
  const channels: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    process.env['DATABASE_STATEMENT_TIMEOUT_MS'] = '3000';
    process.env['LOG_LEVEL'] = 'warn';
    const { setLogCaptureStream } = await import('../../src/lib/logger.js');
    setLogCaptureStream(new Writable({ write(chunk: Buffer, _enc, done): void { logged += chunk.toString(); done(); } }));
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    const admin = await userWithRole(mods.pool, 'admin', null);
    token = admin.token;
    users.push(actor.userId, admin.id);
    engineMod = await import('../../src/engine.js');
    deployment = await import('../../src/services/deployment.service.js');
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
    ({ server: partner, base: partnerUrl } = await listen((req, res) => { requests += 1; res.statusCode = req.url === '/refuse' ? 500 : 200; res.end(`MRN-8675309${NUL}`); }));
  });

  beforeEach(() => { logged = ''; requests = 0; });

  afterAll(async () => {
    for (const s of [server, partner]) await closeServer(s);
    await engineMod?.getEngine().dispose();
    if (channels.length > 0) await mods.pool.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [channels]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods?.pool.end();
  });

  const create = (password: string, selectQuery: string): ReturnType<typeof apiCall> => apiCall(base, token, 'POST', '/channels', {
    name: `itest-query-error-${randomUUID()}`, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'NONE', sourceConnectorType: 'DATABASE',
    sourceConnectorProperties: { host: 'h', port: 5432, database: 'd', username: 'u', password, selectQuery },
  });

  it('holds no connector password when Postgres refuses a channel', async () => {
    expect((await create('S-refused', `SELECT 'a${NUL}b'`)).status).toBe(500);
    expect(logged).toContain('Failed query (22P05): insert into');
    expect(logged).not.toContain('S-refused');
  });

  it('holds no connector password when saving a channel hits the statement timeout', async () => {
    const holder = await mods.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE channels IN SHARE MODE');
      expect((await create('S-timeout', 'SELECT 1')).status).toBe(500);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect(logged).toContain('Failed query (57014): insert into');
    expect(logged).not.toContain('S-timeout');
  });

  interface Settings {
    readonly queueMode: string;
    readonly encryptData?: boolean;
    readonly transformer?: string;
    readonly prepare?: (channelId: string) => Promise<unknown>;
  }

  /** Sends one message to the partner and runs the checks while the channel is deployed. */
  async function withMessageTo(path: string, settings: Settings, check: (channelId: string) => Promise<void>): Promise<void> {
    const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-query-error-${randomUUID()}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'AUTO_AFTER_DESTINATIONS',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      properties: { encryptData: settings.encryptData ?? false },
      destinations: [{ name: 'H', connectorType: 'HTTP', queueMode: settings.queueMode, properties: { url: `${partnerUrl}${path}` } }],
      transformers: settings.transformer === undefined ? [] : [
        { metaDataId: 1, inboundDataType: 'RAW', outboundDataType: 'RAW', steps: [{ type: 'JAVASCRIPT', script: settings.transformer }] },
      ],
    }), actor));
    channels.push(channel.id);
    await settings.prepare?.(channel.id);
    unwrap(await deployment.DeploymentService.deploy(channel.id, actor));
    if (engineMod.getEngine().getRuntime(channel.id)!.runtime.getState() !== 'STARTED') unwrap(await deployment.DeploymentService.start(channel.id, actor));
    try {
      expect((await apiCall(base, token, 'POST', `/channels/${channel.id}/send-message`, { content: 'hello' })).status).toBeLessThan(300);
      await check(channel.id);
    } finally {
      await deployment.DeploymentService.stop(channel.id, actor);
      await deployment.DeploymentService.undeploy(channel.id, actor);
    }
  }

  const destinationStatus = async (channelId: string): Promise<unknown> => (await mods.pool.query(
    'SELECT status FROM connector_messages WHERE channel_id = $1 AND meta_data_id = 1', [channelId])).rows;

  const PARTNERS = [
    ['refused it', '/refuse', 'NEVER', 'ERROR', 'the response of a failed destination'],
    ['took it', '/accept', 'NEVER', 'SENT', 'the response of a delivered destination'],
    ['took it from the queue', '/accept', 'ALWAYS', 'SENT', 'the response of a delivered destination'],
  ] as const;

  /** Postgres quotes the whole row it refuses for a CHECK constraint. On the channel's own partition, so no other channel can meet it. */
  const refuseAnswers = (channelId: string): Promise<unknown> => mods.pool.query(
    `ALTER TABLE message_content_p_${channelId.replaceAll('-', '_')} ADD CHECK (content_type <> ${String(CONTENT_TYPE.RESPONSE)})`);

  it.each(PARTNERS)('says that the answer of a partner that %s cannot be stored, without the answer, and the message keeps its status', async (_what, path, queueMode, status, what) => {
    await withMessageTo(path, { queueMode, prepare: refuseAnswers }, async (channelId) => {
      await vi.waitFor(() => { expect(logged).toContain(`"what":"${what}"`); }, WAIT);
      expect(logged).toContain('Message store write failed');
      await vi.waitFor(async () => { expect(await destinationStatus(channelId)).toEqual([{ status }]); }, WAIT);
      const stored = await mods.pool.query('SELECT content_type FROM message_content WHERE channel_id = $1 AND meta_data_id = 1', [channelId]);
      expect(stored.rows).not.toContainEqual({ content_type: CONTENT_TYPE.RESPONSE });
      expect(logged).toContain('Failed query (23514');
      expect(logged).not.toContain('MRN-8675309');
    });
  });

  it('sends nothing when what is to be sent holds U+0000: it cannot be stored, so the destination ends in ERROR', async () => {
    await withMessageTo('/accept', { queueMode: 'NEVER', transformer: 'msg = String(msg) + String.fromCharCode(0);' }, async (channelId) => {
      await vi.waitFor(async () => { expect(await destinationStatus(channelId)).toEqual([{ status: 'ERROR' }]); }, WAIT);
      const stored = await mods.pool.query('SELECT content FROM message_content WHERE channel_id = $1 AND meta_data_id = 1 ORDER BY content_type', [channelId]);
      expect(stored.rows).toEqual([{ content: expect.stringContaining('storeSentContent: Failed query (22021)') as unknown }]);
      expect(requests).toBe(0);
    });
  });

  it.each(PARTNERS)('keeps the answer of a partner that %s when it holds U+0000, as U+2400, and the log has no answer', async (_what, path, queueMode, status) => {
    await withMessageTo(path, { queueMode }, async (channelId) => {
      await vi.waitFor(async () => { expect(await destinationStatus(channelId)).toEqual([{ status }]); }, WAIT);
      const stored = await mods.pool.query('SELECT content FROM message_content WHERE channel_id = $1 AND meta_data_id = 1 AND content_type = $2', [channelId, CONTENT_TYPE.RESPONSE]);
      expect(stored.rows).toEqual([{ content: 'MRN-8675309\u2400' }]);
      expect(logged).toContain('U+0000');
      expect(logged).not.toContain('Message store write failed');
      expect(logged).not.toContain('MRN-8675309');
    });
  });

  it('keeps an answer that holds U+0000 exactly on a channel that encrypts its content', async () => {
    const { decryptContent } = await import('../../src/lib/content-crypto.js');
    await withMessageTo('/accept', { queueMode: 'NEVER', encryptData: true }, async (channelId) => {
      await vi.waitFor(async () => { expect(await destinationStatus(channelId)).toEqual([{ status: 'SENT' }]); }, WAIT);
      const stored = await mods.pool.query('SELECT content FROM message_content WHERE channel_id = $1 AND meta_data_id = 1 AND content_type = $2', [channelId, CONTENT_TYPE.RESPONSE]);
      expect(unwrap(decryptContent((stored.rows[0] as { content: string }).content))).toBe(`MRN-8675309${NUL}`);
      expect(logged).not.toContain('U+0000');
    });
  });
});
