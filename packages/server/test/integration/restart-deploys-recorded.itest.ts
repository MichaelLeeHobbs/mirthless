// ===========================================
// A restart deploys what was deployed (#225) — real Postgres + real engine
// ===========================================
// A restart is simulated in-process: every runtime is undeployed the way a
// server shutdown does it (lib/shutdown.ts undeployAll), then the startup
// redeploy runs. Each test saves an edit without deploying it and checks that
// the restarted channel still runs what was deployed.

import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE, createChannelSchema, type CreateChannelInput } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';

describeIntegration('A restart deploys the recorded deployment, not the saved head (#225)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js');
  let engineMod: typeof import('../../src/engine.js');
  let shutdown: typeof import('../../src/lib/shutdown.js');
  let templates: typeof import('../../src/services/code-template.service.js');
  let globals: typeof import('../../src/services/global-script.service.js');
  const created: Array<{ readonly id: string; readonly name: string }> = [];
  const silent = { error: (): void => {} };

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    deployment = await import('../../src/services/deployment.service.js');
    engineMod = await import('../../src/engine.js');
    shutdown = await import('../../src/lib/shutdown.js');
    templates = await import('../../src/services/code-template.service.js');
    globals = await import('../../src/services/global-script.service.js');
  });

  // Each test starts with nothing deployed and its channels from earlier tests disabled.
  afterEach(async () => {
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    for (const ch of created) await mods.ChannelService.setEnabled(ch.id, false);
  });

  afterAll(async () => {
    if (engineMod) await engineMod.getEngine().dispose();
    await mods?.pool.end();
  });

  /** Shut every channel down as a server stop does, then run the startup redeploy. */
  async function restart(): Promise<string | null> {
    await shutdown.undeployAll(engineMod.getEngine(), silent);
    const result = await deployment.DeploymentService.autoDeployChannels();
    return result.ok ? null : result.error.message;
  }

  function channelInput(transformerScript: string): CreateChannelInput {
    return createChannelSchema.parse({
      name: `itest-225-${randomUUID()}`,
      enabled: true,
      properties: { initialState: 'STARTED' },
      inboundDataType: 'RAW',
      outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT',
      sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      responseMode: 'AUTO_AFTER_DESTINATIONS',
      transformers: [{ inboundDataType: 'RAW', outboundDataType: 'RAW', steps: [{ type: 'JAVASCRIPT', script: transformerScript }] }],
      destinations: [{ name: 'Sink', connectorType: 'JAVASCRIPT', properties: { script: "return 'ok';" } }],
    });
  }

  async function createChannel(transformerScript: string): Promise<{ readonly id: string; readonly name: string }> {
    const channel = unwrap(await mods.ChannelService.create(channelInput(transformerScript), actor));
    const entry = { id: channel.id, name: channel.name };
    created.push(entry);
    return entry;
  }

  /** Send `content` through the channel and return the source's transformed content. */
  async function transformedBy(channelId: string, content: string): Promise<string | null> {
    const sent = unwrap(await deployment.DeploymentService.sendMessage(channelId, content));
    return unwrap(await mods.MessageService.loadContent(channelId, sent.messageId, 0, CONTENT_TYPE.TRANSFORMED));
  }

  async function saveTransformer(channelId: string, script: string): Promise<void> {
    const current = unwrap(await mods.ChannelService.getById(channelId));
    unwrap(await mods.ChannelService.update(channelId, {
      revision: current.revision,
      transformers: [{
        connectorId: null, metaDataId: null, inboundDataType: 'RAW', outboundDataType: 'RAW',
        inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null,
        steps: [{ enabled: true, type: 'JAVASCRIPT', script, language: 'JAVASCRIPT', sourceField: null, targetField: null, defaultValue: null, mapping: null }],
      }],
    }, actor));
  }

  function isDeployed(channelId: string): boolean {
    return engineMod.getEngine().getRuntime(channelId) !== undefined;
  }

  it('runs the deployed transformer after a restart, not an edit saved without deploying', async () => {
    const { id } = await createChannel("msg = 'deployed:' + String(msg);");
    unwrap(await deployment.DeploymentService.deploy(id, actor));
    expect(await transformedBy(id, 'a')).toBe('deployed:a');

    await saveTransformer(id, "msg = 'edited:' + String(msg);");
    expect(await restart()).toBeNull();

    expect(await transformedBy(id, 'b')).toBe('deployed:b');
  });

  it('runs the deployed code template after a restart, not one edited since', async () => {
    const { CodeTemplateService } = templates;
    const fn = `tag${randomUUID().replace(/-/g, '')}`;
    const { id } = await createChannel(`msg = ${fn}(String(msg));`);
    const library = unwrap(await CodeTemplateService.createLibrary({ name: `itest-225-${randomUUID()}`, description: '', channelIds: [id] }, actor));
    const template = unwrap(await CodeTemplateService.createTemplate({
      libraryId: library.id, name: fn, description: '', type: 'FUNCTION', language: 'JAVASCRIPT',
      code: `function ${fn}(s) { return 'v1:' + s; }`, contexts: ['SOURCE_FILTER_TRANSFORMER'],
    }, actor));
    unwrap(await deployment.DeploymentService.deploy(id, actor));
    expect(await transformedBy(id, 'a')).toBe('v1:a');

    unwrap(await CodeTemplateService.updateTemplate(template.id, { code: `function ${fn}(s) { return 'v2:' + s; }`, revision: template.revision }, actor));
    expect(await restart()).toBeNull();

    expect(await transformedBy(id, 'b')).toBe('v1:b');
  });

  it('runs the deployed global preprocessor after a restart, not one edited since', async () => {
    const { GlobalScriptService } = globals;
    const before = unwrap(await GlobalScriptService.getAll());
    try {
      unwrap(await GlobalScriptService.update({ preprocessor: "msg = 'g1:' + String(msg);", languages: { preprocessor: 'JAVASCRIPT' } }, actor));
      const { id } = await createChannel("msg = 't:' + String(msg);");
      unwrap(await deployment.DeploymentService.deploy(id, actor));
      expect(await transformedBy(id, 'a')).toBe('t:g1:a');

      unwrap(await GlobalScriptService.update({ preprocessor: "msg = 'g2:' + String(msg);" }, actor));
      expect(await restart()).toBeNull();

      expect(await transformedBy(id, 'b')).toBe('t:g1:b');
    } finally {
      unwrap(await GlobalScriptService.update({ preprocessor: before.preprocessor, languages: { preprocessor: before.languages.preprocessor } }, actor));
    }
  });

  it('does not deploy an enabled channel that was never deployed', async () => {
    const { id } = await createChannel("msg = 'never:' + String(msg);");
    expect(await restart()).toBeNull();
    expect(isDeployed(id)).toBe(false);
  });

  it('a deploy after the edit is what the next restart runs', async () => {
    const { id } = await createChannel("msg = 'first:' + String(msg);");
    unwrap(await deployment.DeploymentService.deploy(id, actor));
    await saveTransformer(id, "msg = 'second:' + String(msg);");
    unwrap(await deployment.DeploymentService.redeploy(id, actor));
    expect(await restart()).toBeNull();
    expect(await transformedBy(id, 'c')).toBe('second:c');
  });

  it('leaves a channel someone undeployed undeployed after a restart, until it is deployed again', async () => {
    const { id } = await createChannel("msg = 'u:' + String(msg);");
    unwrap(await deployment.DeploymentService.deploy(id, actor));
    unwrap(await deployment.DeploymentService.stop(id, actor));
    unwrap(await deployment.DeploymentService.undeploy(id, actor));

    expect(await restart()).toBeNull();
    expect(isDeployed(id)).toBe(false);

    unwrap(await deployment.DeploymentService.deploy(id, actor));
    expect(await restart()).toBeNull();
    expect(isDeployed(id)).toBe(true);
  });

  it('refuses a record it cannot read, naming the channel, instead of deploying the saved head', async () => {
    const { id, name } = await createChannel("msg = 'r:' + String(msg);");
    unwrap(await deployment.DeploymentService.deploy(id, actor));
    await mods.pool.query('UPDATE channel_deployments SET format = 999 WHERE channel_id = $1', [id]);

    const failure = await restart();

    expect(failure).toContain(name);
    expect(isDeployed(id)).toBe(false);
  });

  it('records the saved configuration of a channel enabled at the upgrade, once, then keeps it', async () => {
    const { id } = await createChannel("msg = 'saved:' + String(msg);");
    // What migration 0026 does for each channel enabled when it runs.
    await mods.pool.query('INSERT INTO channel_deployment_adoptions (channel_id) VALUES ($1)', [id]);

    expect(await restart()).toBeNull();
    expect(await transformedBy(id, 'a')).toBe('saved:a');
    const { rows } = await mods.pool.query('SELECT count(*)::int AS n FROM channel_deployment_adoptions WHERE channel_id = $1', [id]);
    expect(rows[0]).toEqual({ n: 0 });

    await saveTransformer(id, "msg = 'later:' + String(msg);");
    expect(await restart()).toBeNull();
    expect(await transformedBy(id, 'b')).toBe('saved:b');
  });

  it('enabling a channel raises its revision, so an editor opened before cannot save the old flag back', async () => {
    const { id } = await createChannel("msg = String(msg);");
    const opened = unwrap(await mods.ChannelService.getById(id));
    unwrap(await mods.ChannelService.setEnabled(id, false, actor));

    const stale = await mods.ChannelService.update(id, { revision: opened.revision, enabled: true }, actor);

    expect(stale.ok).toBe(false);
    expect(unwrap(await mods.ChannelService.getById(id)).enabled).toBe(false);
  });
});
