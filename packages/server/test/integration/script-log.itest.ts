// What scripts write with logger: on the message, to people who may read it, and in the server log
// while the setting is on (#164, D-387). Needs CONTENT_ENCRYPTION_KEY.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_TYPE, MAX_SCRIPT_LOG_FIRST_RUNS, MAX_SCRIPT_LOG_LINES, MAX_SCRIPT_LOG_RUNS, createChannelSchema, readScriptLog, type ScriptLog } from '@galvanigraph/core-models';
import {
  adminActor, apiCall, closeServer, describeIntegration, listen, loadServerModules, unwrap, userWithRole, WAIT,
  type ServerModules, type TestActor,
} from './_setup.js';

const SETTING = 'logging.script_output';

describeIntegration('what scripts log (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let admin: string;
  let viewer: string;
  let server: Server;
  let base: string;
  let logged = '';
  let engineMod: typeof import('../../src/engine.js');
  let deployment: typeof import('../../src/services/deployment.service.js');
  const channels: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    process.env['LOG_LEVEL'] = 'info';
    const { setLogCaptureStream } = await import('../../src/lib/logger.js');
    setLogCaptureStream(new Writable({ write(chunk: Buffer, _enc, done): void { logged += chunk.toString(); done(); } }));
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    const a = await userWithRole(mods.pool, 'admin', null);
    const v = await userWithRole(mods.pool, 'viewer', null);
    admin = a.token;
    viewer = v.token;
    users.push(actor.userId, a.id, v.id);
    engineMod = await import('../../src/engine.js');
    deployment = await import('../../src/services/deployment.service.js');
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
  });

  async function setting(value: string): Promise<void> {
    expect((await apiCall(base, admin, 'PUT', `/settings/${SETTING}`, { key: SETTING, value, type: 'boolean' })).status).toBe(200);
  }

  beforeEach(() => { logged = ''; });
  afterEach(async () => { await setting('false'); });

  afterAll(async () => {
    await closeServer(server);
    await engineMod?.getEngine().dispose();
    if (channels.length > 0) await mods.pool.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [channels]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods?.pool.end();
  });

  interface Channel {
    readonly filter?: string;
    readonly deployScript?: string;
  readonly undeployScript?: string;
    readonly destination?: Record<string, unknown>;
    readonly transformer?: string;
    readonly source?: string;
    readonly pollingIntervalMs?: number;
    readonly messageStorageMode?: string;
    readonly encryptData?: boolean;
  }

  /** Deploys the channel, runs `use` and takes it down again. */
  async function withChannel(settings: Channel, use: (channelId: string) => Promise<void>): Promise<void> {
    const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-script-log-${randomUUID()}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'AUTO_AFTER_DESTINATIONS',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: settings.source ?? 'return [];', pollingIntervalMs: settings.pollingIntervalMs ?? 600_000 },
      properties: { encryptData: settings.encryptData ?? false, ...(settings.messageStorageMode === undefined ? {} : { messageStorageMode: settings.messageStorageMode }) },
      scripts: { ...(settings.deployScript === undefined ? {} : { deploy: settings.deployScript }), ...(settings.undeployScript === undefined ? {} : { undeploy: settings.undeployScript }) },
      destinations: [{ name: 'JS', connectorType: 'JAVASCRIPT', properties: { script: 'return "ok";' }, ...settings.destination }],
      filters: settings.filter === undefined ? [] : [{ connectorId: null, rules: [{ type: 'JAVASCRIPT', script: settings.filter }] }],
      transformers: settings.transformer === undefined ? [] : [
        { metaDataId: 1, inboundDataType: 'RAW', outboundDataType: 'RAW', steps: [{ type: 'JAVASCRIPT', script: settings.transformer }] },
      ],
    }), actor));
    channels.push(channel.id);
    unwrap(await deployment.DeploymentService.deploy(channel.id, actor));
    if (engineMod.getEngine().getRuntime(channel.id)!.runtime.getState() !== 'STARTED') unwrap(await deployment.DeploymentService.start(channel.id, actor));
    try {
      await use(channel.id);
    } finally {
      await deployment.DeploymentService.stop(channel.id, actor);
      await deployment.DeploymentService.undeploy(channel.id, actor);
    }
  }

  async function send(channelId: string): Promise<number> {
    expect((await apiCall(base, admin, 'POST', `/channels/${channelId}/send-message`, { content: 'hello' })).status).toBeLessThan(300);
    const { rows } = await mods.pool.query<{ id: string }>('SELECT id FROM messages WHERE channel_id = $1 ORDER BY id DESC LIMIT 1', [channelId]);
    return Number(rows[0]!.id);
  }

  interface Detail {
    readonly connectors: readonly { readonly metaDataId: number; readonly content: Readonly<Record<string, string>> }[];
  }

  async function logOf(channelId: string, messageId: number, metaDataId: number, token = viewer): Promise<ScriptLog | null> {
    const detail = await apiCall<Detail>(base, token, 'GET', `/channels/${channelId}/messages/${String(messageId)}`);
    const text = detail.json.data?.connectors.find((c) => c.metaDataId === metaDataId)?.content['scriptLog'];
    const log = text === undefined ? null : readScriptLog(text);
    // The seeded global scripts log too.
    return log === null ? null : { ...log, runs: log.runs.filter((r) => !r.script.startsWith('Global')) };
  }

  const texts = (log: ScriptLog | null): [string, string[]][] => (log?.runs ?? []).map((r) => [r.script, r.lines.map((l) => `${l.level} ${l.text}`)]);

  /** The script's lines in the server log. */
  const serverLines = (): Record<string, unknown>[] => logged.split('\n').filter((l) => l.includes('"channel-script"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => !String(l['script']).startsWith('Global'));

  describe('on the message', () => {
    it('shows each script\'s lines on its connector, with level and time, to one who may read messages', async () => {
      await withChannel({
        filter: 'logger.info("source " + msg); return true;',
        transformer: 'logger.warn("before sending"); return msg;',
        destination: { properties: { script: 'logger.error("in the writer"); return "ok";' } },
      }, async (channelId) => {
        const messageId = await send(channelId);

        expect(texts(await logOf(channelId, messageId, 0))).toEqual([['Source filter', ['INFO source hello']]]);
        expect(texts(await logOf(channelId, messageId, 1))).toEqual([['Destination transformer', ['WARN before sending']], ['JavaScript destination', ['ERROR in the writer']]]);
        const time = (await logOf(channelId, messageId, 0))?.runs[0]?.lines[0]?.time ?? '';
        expect(Math.abs(Date.now() - Date.parse(time))).toBeLessThan(60_000);
      });
    });

    it('shows the first lines of a run and how many were left out, and the lines of a script that fails', async () => {
      await withChannel({ filter: 'for (let i = 0; i < 250; i++) logger.info(i); throw new Error("broke");' }, async (channelId) => {
        const log = await logOf(channelId, await send(channelId), 0);

        expect(log?.runs[0]?.lines).toHaveLength(MAX_SCRIPT_LOG_LINES);
        expect(log?.runs[0]?.leftOut).toBe(250 - MAX_SCRIPT_LOG_LINES);
      });
    });

    it('keeps the last runs of a destination that its queue tries again and again', async () => {
      await withChannel({
        destination: { properties: { script: 'logger.info("try"); throw new Error("not yet");' }, queueMode: 'ALWAYS', retryCount: 0, retryIntervalMs: 1 },
      }, async (channelId) => {
        const messageId = await send(channelId);
        await vi.waitFor(async () => { expect((await logOf(channelId, messageId, 1))?.runs.length).toBeGreaterThan(0); }, WAIT);
        // As after many tries: it tries once a second.
        const runs = Array.from({ length: MAX_SCRIPT_LOG_RUNS }, (_, i) => ({ script: `try ${String(i)}`, lines: [], leftOut: 0 }));
        await mods.pool.query('UPDATE message_content SET content = $3 WHERE channel_id = $1 AND message_id = $2 AND meta_data_id = 1 AND content_type = 14', [channelId, messageId, JSON.stringify({ runs, runsLeftOut: 0 })]);

        await vi.waitFor(async () => { expect((await logOf(channelId, messageId, 1))?.runsLeftOut).toBeGreaterThan(0); }, WAIT);
        const log = await logOf(channelId, messageId, 1);
        expect(log?.runs).toHaveLength(MAX_SCRIPT_LOG_RUNS);
        expect(log?.runs.at(-1)?.script).toBe('JavaScript destination');
        expect(log?.runs.slice(0, MAX_SCRIPT_LOG_FIRST_RUNS + 1).map((r) => r.script)).not.toContain('try 5');
        expect(log?.runs[0]?.script).toBe('try 0');
      });
    });

    it.each([
      ['PRODUCTION', true],
      ['RAW', true],
      ['METADATA', false],
      ['DISABLED', false],
    ])('is stored as errors are: storage %s', async (messageStorageMode, kept) => {
      await withChannel({ filter: 'logger.info("x"); return true;', messageStorageMode }, async (channelId) => {
        await send(channelId);

        const { rows } = await mods.pool.query('SELECT 1 FROM message_content WHERE channel_id = $1 AND meta_data_id = 0 AND content_type = $2', [channelId, CONTENT_TYPE.SCRIPT_LOG]);
        expect(rows.length > 0).toBe(kept);
      });
    });

    it('is encrypted on a channel that encrypts its content, and shown', async () => {
      await withChannel({ filter: 'logger.info("MRN-8675309"); return true;', transformer: 'logger.info("again"); return msg;', encryptData: true }, async (channelId) => {
        const messageId = await send(channelId);

        const { rows } = await mods.pool.query<{ content: string }>('SELECT content FROM message_content WHERE channel_id = $1 AND content_type = $2', [channelId, CONTENT_TYPE.SCRIPT_LOG]);
        expect(rows).toHaveLength(2);
        for (const row of rows) expect(row.content).not.toMatch(/MRN-8675309|again/);
        expect(texts(await logOf(channelId, messageId, 0))).toEqual([['Source filter', ['INFO MRN-8675309']]]);
        expect(texts(await logOf(channelId, messageId, 1))).toEqual([['Destination transformer', ['INFO again']]]);
      });
    });
  });

  describe('in the server log', () => {
    const CHANNEL: Channel = {
      deployScript: 'logger.info("deploying MRN-1");',
      undeployScript: 'logger.info("undeploying MRN-9");',
      source: 'logger.info("polling MRN-2"); return [];',
      pollingIntervalMs: 1_000,
      filter: 'logger.warn("filtering MRN-3"); return true;',
      destination: { properties: { script: 'logger.error("writing MRN-4"); return "ok";' } },
    };

    it('is nothing until the setting is on', async () => {
      await withChannel(CHANNEL, async (channelId) => { await send(channelId); });

      expect(serverLines()).toEqual([]);
      expect(logged).not.toContain('MRN-');
    });

    it('has the level, channel, message, connector and script of each line while it is on, in order', async () => {
      await setting('true');
      let channelId = '';
      let messageId = 0;
      await withChannel(CHANNEL, async (id) => {
        channelId = id;
        await vi.waitFor(() => { expect(logged).toContain('polling MRN-2'); }, WAIT);
        messageId = await send(id);
      });

      const at = { channelId, messageId: String(messageId) };
      const of = `channel ${channelId}, message ${String(messageId)}`;
      const destination = `${of}, destination 1`;
      const firstPoll = serverLines().findIndex((l) => l['script'] === 'JavaScript source');
      // It polls every second.
      const lines = serverLines().filter((l, i) => l['script'] !== 'JavaScript source' || i === firstPoll);
      expect(lines.map(({ level, msg, channelId: c, messageId: m, metaDataId, script }) => ({ level, msg, channelId: c, messageId: m, metaDataId, script }))).toEqual([
        { level: 30, msg: `[Deploy, channel ${channelId}] deploying MRN-1`, channelId, messageId: undefined, metaDataId: undefined, script: 'Deploy' },
        { level: 30, msg: `[JavaScript source, channel ${channelId}] polling MRN-2`, channelId, messageId: undefined, metaDataId: undefined, script: 'JavaScript source' },
        { level: 40, msg: `[Source filter, ${of}] filtering MRN-3`, ...at, metaDataId: 0, script: 'Source filter' },
        { level: 50, msg: `[JavaScript destination, ${destination}] writing MRN-4`, ...at, metaDataId: 1, script: 'JavaScript destination' },
        { level: 30, msg: `[Undeploy, channel ${channelId}] undeploying MRN-9`, channelId, messageId: undefined, metaDataId: undefined, script: 'Undeploy' },
      ]);
    });

    it('has the first lines of a run and says how many are left out', async () => {
      await setting('true');
      await withChannel({ filter: 'for (let i = 0; i < 250; i++) logger.info("line " + i); return true;' }, async (channelId) => { await send(channelId); });

      const lines = serverLines();
      expect(lines).toHaveLength(MAX_SCRIPT_LOG_LINES + 1);
      expect(lines.at(-1)).toMatchObject({ level: 40, msg: expect.stringContaining('] 50 more lines of this script run are left out') as string, script: 'Source filter' });
    });

    it.each<[string, () => Promise<unknown>]>([
      ['setting it off', () => setting('false')],
      ['setting it off with others', () => apiCall(base, admin, 'PUT', '/settings/bulk', { settings: [{ key: SETTING, value: 'false', type: 'boolean' }] })],
      ['deleting it', () => apiCall(base, admin, 'DELETE', `/settings/${SETTING}`)],
    ])('is nothing after %s, for a channel that runs', async (_case, turnOff) => {
      await setting('true');
      await withChannel({ filter: 'logger.info("MRN-5"); return true;' }, async (channelId) => {
        await send(channelId);
        expect(logged).toContain('MRN-5');
        logged = '';

        await turnOff();
        await send(channelId);

        expect(logged).not.toContain('MRN-5');
      });
    });

    it('is as stored at a start, and off when that cannot be read', async () => {
      const { SettingsService } = await import('../../src/services/settings.service.js');
      const { setScriptLogging } = await import('../../src/lib/script-log.js');
      await withChannel({ filter: 'logger.info("MRN-6"); return true;' }, async (channelId) => {
        await setting('true');
        setScriptLogging(false);
        await SettingsService.applied();
        await send(channelId);
        expect(logged).toContain('MRN-6');

        logged = '';
        const read = vi.spyOn(SettingsService, 'getStoredValues').mockResolvedValueOnce({ ok: false, value: null, error: new Error('no database') } as never);
        await SettingsService.applied();
        read.mockRestore();
        await send(channelId);
        expect(logged).not.toContain('MRN-6');
        expect(logged).toContain('could not be read');
      });
    });
  });
});
