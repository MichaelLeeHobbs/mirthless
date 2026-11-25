import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createChannelSchema } from '@galvanigraph/core-models';
import { adminActor, deleteTestChannel, describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('AlertService triggers (real Postgres)', () => {
  let mods: ServerModules;
  let AlertService: typeof import('../../src/services/alert.service.js').AlertService;
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
    AlertService = (await import('../../src/services/alert.service.js')).AlertService;
  });

  afterEach(async () => {
    for (const id of created.splice(0)) {
      unwrap(await AlertService.delete(id));
    }
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  const base = {
    description: '', enabled: true, channelIds: [], actions: [],
    subjectTemplate: null, bodyTemplate: null, reAlertIntervalMs: null, maxAlerts: null,
  };

  it('stores and reads back a NO_MESSAGES trigger', async () => {
    const alert = unwrap(await AlertService.create({
      ...base, name: `itest-silence-${Math.random().toString(36).slice(2)}`,
      trigger: { type: 'NO_MESSAGES', windowMinutes: 30 },
    }));
    created.push(alert.id);

    const detail = unwrap(await AlertService.getById(alert.id));
    expect(detail.trigger).toEqual({ type: 'NO_MESSAGES', errorTypes: [], regex: null, windowMinutes: 30 });
  });

  it('switches an alert from NO_MESSAGES to CHANNEL_ERROR', async () => {
    const alert = unwrap(await AlertService.create({
      ...base, name: `itest-switch-${Math.random().toString(36).slice(2)}`,
      trigger: { type: 'NO_MESSAGES', windowMinutes: 5 },
    }));
    created.push(alert.id);

    unwrap(await AlertService.update(alert.id, {
      revision: alert.revision,
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'timeout' },
    }));

    const detail = unwrap(await AlertService.getById(alert.id));
    expect(detail.trigger).toEqual({ type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'timeout', windowMinutes: null });
  });

  describe('loaded by the engine (#417)', () => {
    const PREFIX = `itest-417-${randomUUID()}`;
    const names = (alerts: readonly { readonly name: string }[]): string[] =>
      alerts.map((a) => a.name).filter((name) => name.startsWith(PREFIX));

    afterEach(async () => {
      await mods.pool.query('DELETE FROM alerts WHERE name LIKE $1', [`${PREFIX}%`]);
    });

    it('reads every enabled alert, however many there are, with its channels and actions', async () => {
      await mods.pool.query(
        `INSERT INTO alerts (name, enabled, trigger_type, trigger_script)
         SELECT $1 || '-' || lpad(n::text, 4, '0'), n <> 7, 'CHANNEL_ERROR', '{"errorTypes":["ANY"],"regex":null}' FROM generate_series(1, 1205) AS n`,
        [PREFIX],
      );
      const channelId = randomUUID();
      const actor = await adminActor(mods.pool);
      const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
        name: `itest-417-${channelId}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW',
        sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 }, destinations: [],
      }), actor));
      const last = `${PREFIX}-1205`;
      await mods.pool.query('INSERT INTO alert_channels SELECT id, $2 FROM alerts WHERE name = $1', [last, channel.id]);
      await mods.pool.query(`INSERT INTO alert_actions (alert_id, action_type, recipients) SELECT id, 'EMAIL', '["oncall@example.test"]' FROM alerts WHERE name = $1`, [last]);

      try {
        const enabled = unwrap(await AlertService.listEnabled());

        expect(names(enabled)).toHaveLength(1204);
        expect(names(enabled)).not.toContain(`${PREFIX}-0007`);
        expect(enabled.find((a) => a.name === last)).toMatchObject({ channelIds: [channel.id], actions: [{ recipients: ['oncall@example.test'] }] });
        expect(enabled.find((a) => a.name === `${PREFIX}-0001`)).toMatchObject({ channelIds: [], actions: [] });
      } finally {
        await deleteTestChannel(mods, channel.id);
      }
    });

    it('is in force on a deployed channel after each change, without a redeploy', async () => {
      const { DeploymentService } = await import('../../src/services/deployment.service.js');
      const { getEngine } = await import('../../src/engine.js');
      const actor = await adminActor(mods.pool);
      const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
        name: `${PREFIX}-channel`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW',
        sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 }, destinations: [],
      }), actor));
      unwrap(await DeploymentService.deploy(channel.id, actor));
      const loaded = (): string[] => names(getEngine().getRuntime(channel.id)!.alertManager.getAlerts());

      try {
        const input = { ...base, trigger: { type: 'CHANNEL_ERROR' as const, errorTypes: ['ANY' as const], regex: null } };
        const alert = unwrap(await AlertService.create({ ...input, name: `${PREFIX}-live` }));
        await expect.poll(loaded).toEqual([`${PREFIX}-live`]);

        unwrap(await AlertService.update(alert.id, { revision: alert.revision, name: `${PREFIX}-renamed` }));
        await expect.poll(loaded).toEqual([`${PREFIX}-renamed`]);

        unwrap(await AlertService.setEnabled(alert.id, false));
        await expect.poll(loaded).toEqual([]);

        unwrap(await AlertService.setEnabled(alert.id, true));
        await expect.poll(loaded).toEqual([`${PREFIX}-renamed`]);

        unwrap(await AlertService.delete(alert.id));
        await expect.poll(loaded).toEqual([]);
      } finally {
        await DeploymentService.stop(channel.id, actor);
        await DeploymentService.undeploy(channel.id, actor);
        await deleteTestChannel(mods, channel.id);
        await getEngine().dispose();
      }
    });
  });
});
