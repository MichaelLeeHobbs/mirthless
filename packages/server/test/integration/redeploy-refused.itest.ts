// ===========================================
// A refused redeploy leaves the running channel running (#480) — real Postgres + real engine
// ===========================================
// Each test deploys and starts a channel, saves a setting the deploy refuses, redeploys, and checks
// that the redeploy is refused while the channel still takes and processes messages.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createChannelSchema } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';

describeIntegration('A refused redeploy leaves the running channel running (#480)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let deployment: typeof import('../../src/services/deployment.service.js');
  let engineMod: typeof import('../../src/engine.js');
  let configMap: typeof import('../../src/services/config-map.service.js');
  const created: string[] = [];
  const category = `itest480${randomUUID().replace(/-/g, '')}`;

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    deployment = await import('../../src/services/deployment.service.js');
    engineMod = await import('../../src/engine.js');
    configMap = await import('../../src/services/config-map.service.js');
  });

  afterEach(async () => {
    for (const id of created.splice(0)) {
      if (!engineMod.getEngine().getRuntime(id)) continue;
      unwrap(await deployment.DeploymentService.stop(id));
      unwrap(await deployment.DeploymentService.undeploy(id));
    }
  });

  afterAll(async () => {
    if (configMap) await configMap.ConfigMapService.delete(category, 'interval');
    if (engineMod) await engineMod.getEngine().dispose();
    await mods?.pool.end();
  });

  /** A started channel that reads nothing by itself and answers every message it is sent. */
  async function runningChannel(): Promise<string> {
    const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-480-${randomUUID()}`,
      enabled: true,
      properties: { initialState: 'STARTED' },
      inboundDataType: 'RAW',
      outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT',
      sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      transformers: [{ inboundDataType: 'RAW', outboundDataType: 'RAW', steps: [] }],
      destinations: [{ name: 'Sink', connectorType: 'JAVASCRIPT', properties: { script: "return 'ok';" } }],
    }), actor));
    created.push(channel.id);
    expect(unwrap(await deployment.DeploymentService.deploy(channel.id, actor)).state).toBe('STARTED');
    return channel.id;
  }

  async function save(channelId: string, changes: Record<string, unknown>): Promise<void> {
    const current = unwrap(await mods.ChannelService.getById(channelId));
    unwrap(await mods.ChannelService.update(channelId, { revision: current.revision, ...changes } as never, actor));
  }

  async function expectRefusedAndStillRunning(channelId: string, refusal: string): Promise<void> {
    const redeployed = await deployment.DeploymentService.redeploy(channelId, actor);
    expect(redeployed.ok).toBe(false);
    expect(redeployed.error?.message).toContain(refusal);

    expect(unwrap(await deployment.DeploymentService.getStatus(channelId)).state).toBe('STARTED');
    const sent = unwrap(await deployment.DeploymentService.sendMessage(channelId, 'still here'));
    expect(sent.status).toBe('PROCESSED');
  }

  describe('the channel still runs when the saved version has', () => {
    it('a destination setting its schema refuses', async () => {
      const id = await runningChannel();
      const [sink] = unwrap(await mods.ChannelService.getById(id)).destinations;
      await save(id, { destinations: [{ id: sink!.id, name: 'Sink', connectorType: 'JAVASCRIPT', properties: { script: "return 'ok';", notASetting: true } }] });

      await expectRefusedAndStillRunning(id, 'Destination "Sink"');
    });

    it('a configuration map reference that resolves to a value its setting refuses', async () => {
      const id = await runningChannel();
      unwrap(await configMap.ConfigMapService.upsert(category, 'interval', 'soon'));
      await save(id, { sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: `\${${category}.interval}` } });

      await expectRefusedAndStillRunning(id, 'pollingIntervalMs');
    });

    it('Delimited settings that do not validate', async () => {
      const id = await runningChannel();
      await save(id, {
        inboundDataType: 'DELIMITED',
        transformers: [{
          connectorId: null, metaDataId: null, inboundDataType: 'DELIMITED', outboundDataType: 'RAW',
          inboundProperties: { delimited: { columnDelimiter: '' } }, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null, steps: [],
        }],
      });

      await expectRefusedAndStillRunning(id, 'Delimited settings are invalid');
    });
  });

  it('redeploys a setting whose configuration map reference resolves to a value it takes', async () => {
    const id = await runningChannel();
    unwrap(await configMap.ConfigMapService.upsert(category, 'interval', '600000'));
    await save(id, { sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: `\${${category}.interval}` } });

    expect(unwrap(await deployment.DeploymentService.redeploy(id, actor)).state).toBe('STARTED');
  });
});
