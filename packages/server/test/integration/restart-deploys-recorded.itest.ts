// ===========================================
// A restart deploys what was deployed (#225) — real Postgres + real engine
// ===========================================
// A restart is simulated in-process: every runtime is stopped and undeployed,
// then the startup auto-deploy runs. Each test saves an edit without deploying
// it and checks that the restarted channel still runs what was deployed.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTENT_TYPE, createChannelSchema, type CreateChannelInput } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';

describeIntegration('A restart deploys the recorded deployment, not the saved head (#225)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js');
  let engineMod: typeof import('../../src/engine.js');
  let templates: typeof import('../../src/services/code-template.service.js');
  const createdChannelIds: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    deployment = await import('../../src/services/deployment.service.js');
    engineMod = await import('../../src/engine.js');
    templates = await import('../../src/services/code-template.service.js');
  });

  afterAll(async () => {
    if (engineMod) {
      await undeployEverything();
      await engineMod.getEngine().dispose();
    }
    // Disabled, so a later suite's restart does not try to bring them back.
    for (const id of createdChannelIds) await mods.ChannelService.setEnabled(id, false);
    await mods?.pool.end();
  });

  async function undeployEverything(): Promise<void> {
    const { DeploymentService } = deployment;
    for (const [id, deployed] of [...engineMod.getEngine().getAll()]) {
      if (deployed.runtime.getState() !== 'STOPPED') unwrap(await DeploymentService.stop(id));
      unwrap(await DeploymentService.undeploy(id));
    }
  }

  /** Stop and undeploy every channel, then run the startup auto-deploy. */
  async function restart(): Promise<void> {
    await undeployEverything();
    const result = await deployment.DeploymentService.autoDeployChannels();
    // Other suites may leave enabled channels behind; only ours must deploy.
    if (!result.ok) {
      for (const id of createdChannelIds) expect(result.error.message).not.toContain(id);
    }
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

  async function createChannel(transformerScript: string): Promise<string> {
    const created = unwrap(await mods.ChannelService.create(channelInput(transformerScript), actor));
    createdChannelIds.push(created.id);
    return created.id;
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

  it('runs the deployed transformer after a restart, not an edit saved without deploying', async () => {
    const channelId = await createChannel("msg = 'deployed:' + String(msg);");
    unwrap(await deployment.DeploymentService.deploy(channelId, actor));
    expect(await transformedBy(channelId, 'a')).toBe('deployed:a');

    await saveTransformer(channelId, "msg = 'edited:' + String(msg);");
    await restart();

    expect(await transformedBy(channelId, 'b')).toBe('deployed:b');
  });

  it('runs the deployed code template after a restart, not one edited since', async () => {
    const { CodeTemplateService } = templates;
    const fn = `tag${randomUUID().replace(/-/g, '')}`;
    const channelId = await createChannel(`msg = ${fn}(String(msg));`);
    const library = unwrap(await CodeTemplateService.createLibrary({ name: `itest-225-${randomUUID()}`, description: '', channelIds: [channelId] }, actor));
    const template = unwrap(await CodeTemplateService.createTemplate({
      libraryId: library.id, name: fn, description: '', type: 'FUNCTION', language: 'JAVASCRIPT',
      code: `function ${fn}(s) { return 'v1:' + s; }`, contexts: ['SOURCE_FILTER_TRANSFORMER'],
    }, actor));
    unwrap(await deployment.DeploymentService.deploy(channelId, actor));
    expect(await transformedBy(channelId, 'a')).toBe('v1:a');

    unwrap(await CodeTemplateService.updateTemplate(template.id, { code: `function ${fn}(s) { return 'v2:' + s; }`, revision: template.revision }, actor));
    await restart();

    expect(await transformedBy(channelId, 'b')).toBe('v1:b');
  });

  it('does not deploy an enabled channel that was never deployed', async () => {
    const channelId = await createChannel("msg = 'never:' + String(msg);");
    await restart();
    expect(engineMod.getEngine().getRuntime(channelId)).toBeUndefined();
  });

  it('a deploy after the edit is what the next restart runs', async () => {
    const channelId = await createChannel("msg = 'first:' + String(msg);");
    unwrap(await deployment.DeploymentService.deploy(channelId, actor));
    await saveTransformer(channelId, "msg = 'second:' + String(msg);");
    unwrap(await deployment.DeploymentService.redeploy(channelId, actor));
    await restart();
    expect(await transformedBy(channelId, 'c')).toBe('second:c');
  });
});
