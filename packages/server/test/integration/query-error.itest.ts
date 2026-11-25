// What the server logs when a statement fails (D-347). It logged the statement's
// parameters: connector passwords and message content.

import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createChannelSchema } from '@galvanigraph/core-models';
import { adminActor, apiCall, describeIntegration, loadServerModules, unwrap, userWithRole, type ServerModules, type TestActor } from './_setup.js';

const NUL = String.fromCharCode(0);

describeIntegration('the log of a failed statement (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let token: string;
  let server: Server;
  let partner: Server;
  let base: string;
  let logged = '';
  let engineMod: typeof import('../../src/engine.js');
  let deployment: typeof import('../../src/services/deployment.service.js');
  const channels: string[] = [];
  const users: string[] = [];

  const port = (s: Server): number => (s.address() as AddressInfo).port;
  const listen = (s: Server): Promise<void> => new Promise((resolve) => { s.listen(0, '127.0.0.1', () => { resolve(); }); });

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
    server = createServer(app);
    partner = createServer((_req, res) => { res.statusCode = 500; res.end(`MRN-8675309${NUL}`); });
    await listen(server);
    await listen(partner);
    base = `http://127.0.0.1:${String(port(server))}`;
  }, 60_000);

  beforeEach(() => { logged = ''; });

  afterAll(async () => {
    for (const s of [server, partner]) await new Promise<void>((resolve) => { if (s) s.close(() => { resolve(); }); else resolve(); });
    await engineMod?.getEngine().dispose();
    if (channels.length > 0) await mods.pool.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [channels]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods?.pool.end();
  }, 60_000);

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

  it('holds no message content when a partner\'s answer cannot be stored', async () => {
    const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-query-error-${randomUUID()}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'AUTO_AFTER_DESTINATIONS',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      destinations: [{ name: 'H', connectorType: 'HTTP', queueMode: 'NEVER', properties: { url: `http://127.0.0.1:${String(port(partner))}/` } }],
    }), actor));
    channels.push(channel.id);
    unwrap(await deployment.DeploymentService.deploy(channel.id, actor));
    if (engineMod.getEngine().getRuntime(channel.id)!.runtime.getState() !== 'STARTED') unwrap(await deployment.DeploymentService.start(channel.id, actor));
    try {
      await apiCall(base, token, 'POST', `/channels/${channel.id}/send-message`, { content: 'hello' });
      await vi.waitFor(() => { expect(logged).toContain('Message store write failed'); }, 10_000);
      expect(logged).toContain('Failed query (22021): insert into');
      expect(logged).not.toContain('MRN-8675309');
    } finally {
      await deployment.DeploymentService.stop(channel.id, actor);
      await deployment.DeploymentService.undeploy(channel.id, actor);
    }
  }, 60_000);
});
