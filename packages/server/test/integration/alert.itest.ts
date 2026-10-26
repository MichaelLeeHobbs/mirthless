// ===========================================
// Alert Service — real Postgres integration
// ===========================================
// Round-trips both trigger types through the trigger_type/trigger_script
// columns, including switching an alert from one type to the other.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

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
});
