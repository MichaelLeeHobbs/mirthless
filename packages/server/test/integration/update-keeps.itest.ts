// An update keeps what the request leaves out (#400, D-350).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminActor, apiCall, deleteTestChannel, describeIntegration, loadServerModules, userWithRole, type ServerModules } from './_setup.js';

interface Script { readonly id: string; readonly scriptType: string; readonly script: string; readonly language: string }
interface Destination { readonly id: string; readonly name: string; readonly enabled: boolean; readonly connectorType: string; readonly properties: unknown }
interface Channel {
  readonly id: string;
  readonly revision: number;
  readonly scripts: readonly Script[];
  readonly destinations: readonly Destination[];
  readonly metadataColumns: ReadonlyArray<Record<string, unknown>>;
  readonly filters: ReadonlyArray<Record<string, unknown>>;
  readonly transformers: ReadonlyArray<Record<string, unknown>>;
}
interface Alert { readonly id: string; readonly revision: number }

describeIntegration('what an update leaves out (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let admin: string;
  const users: string[] = [];

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    users.push((await adminActor(mods.pool)).userId);
    const made = await userWithRole(mods.pool, 'admin', null);
    users.push(made.id);
    admin = made.token;
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods?.pool.end();
  });

  async function call<T>(method: string, path: string, body?: unknown, token = admin): Promise<T> {
    const answer = await apiCall<T>(base, token, method, path, body);
    expect(answer.status, JSON.stringify(answer.json.error)).toBeLessThan(300);
    return answer.json.data as T;
  }

  describe('of a channel', () => {
    let before: Channel;

    async function read(id: string): Promise<Channel> {
      const channel = await call<Channel>('GET', `/channels/${id}`);
      return { ...channel, scripts: [...channel.scripts].sort((a, b) => a.scriptType.localeCompare(b.scriptType)) };
    }

    beforeEach(async () => {
      const { id } = await call<Channel>('POST', '/channels', {
        name: `itest-400-${randomUUID()}`, description: 'Results to the clinic', enabled: true,
        inboundDataType: 'JSON', outboundDataType: 'XML', responseMode: 'DESTINATION', responseConnectorName: 'Lab',
        sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
        properties: {
          initialState: 'PAUSED', messageStorageMode: 'PRODUCTION', encryptData: true, removeContentOnCompletion: true, removeAttachmentsOnCompletion: true,
          pruningEnabled: true, pruningMaxAgeDays: 45, pruningArchiveEnabled: true, scriptTimeoutSeconds: 12,
        },
        scripts: {
          deploy: 'return 1;', undeploy: 'return 2;', preprocessor: 'return message;', postprocessor: 'return 4;',
          languages: { deploy: 'TYPESCRIPT', undeploy: 'TYPESCRIPT', preprocessor: 'TYPESCRIPT', postprocessor: 'TYPESCRIPT' },
        },
        destinations: [{
          name: 'Lab', enabled: false, connectorType: 'JAVASCRIPT', properties: { script: 'return 1;' },
          queueMode: 'ON_FAILURE', retryCount: 7, retryIntervalMs: 2500, rotateQueue: true, queueThreadCount: 3, waitForPrevious: true,
          responseTransformer: 'return response;', responseTransformerLanguage: 'TYPESCRIPT',
        }],
        metadataColumns: [{ name: 'PatientId', dataType: 'STRING', mappingExpression: 'msg.id' }],
        filters: [{ metaDataId: 1, rules: [
          { type: 'JAVASCRIPT', enabled: false, operator: 'OR', name: 'No tests', script: 'return true;', language: 'TYPESCRIPT' },
          { type: 'RULE_BUILDER', field: 'id', condition: 'EQUALS', values: ['1'] },
        ] }],
        transformers: [{
          metaDataId: 1, inboundDataType: 'JSON', outboundDataType: 'XML', inboundProperties: { a: 1 }, outboundProperties: { b: 2 }, inboundTemplate: '{}', outboundTemplate: '<a/>',
          steps: [
            { type: 'MAPPER', enabled: false, name: 'Id', sourceField: 'id', targetField: 'a', defaultValue: 'none', mapping: 'COPY' },
            { type: 'JAVASCRIPT', script: 'msg = msg;', language: 'TYPESCRIPT' },
          ],
        }],
      });
      before = await read(id);
      return async () => { await deleteTestChannel(mods, id); };
    });

    /** The channel after the update, which changes `changed` and nothing else. */
    async function expectOnly(body: Record<string, unknown>, changed: Record<string, unknown>, token = admin): Promise<void> {
      await call('PUT', `/channels/${before.id}`, { revision: before.revision, ...body }, token);
      expect(await read(before.id)).toEqual({ ...before, ...changed, revision: before.revision + 1, updatedAt: expect.any(String) as string });
    }

    it('keeps everything when the request has the revision alone', async () => {
      await expectOnly({}, {});
    });

    it.each([
      ['name', `itest-400-${randomUUID()}`], ['description', ''], ['enabled', false], ['responseMode', 'NONE'], ['responseConnectorName', null],
    ])('changes the %s and keeps the rest', async (key, value) => {
      await expectOnly({ [key]: value }, { [key]: value });
    });

    it.each([
      ['initialState', 'STARTED'], ['messageStorageMode', 'RAW'], ['encryptData', false], ['removeContentOnCompletion', false], ['removeAttachmentsOnCompletion', false],
      ['pruningEnabled', false], ['pruningMaxAgeDays', null], ['pruningArchiveEnabled', false], ['scriptTimeoutSeconds', 30],
    ])('changes the property %s and keeps the others', async (key, value) => {
      await expectOnly({ properties: { [key]: value } }, { [key]: value });
    });

    const scriptsWith = (scriptType: string, change: Partial<Script>): readonly Script[] =>
      before.scripts.map((s) => (s.scriptType === scriptType ? { ...s, ...change } : s));

    it('changes one script and keeps the others', async () => {
      await expectOnly({ scripts: { undeploy: 'return 22;' } }, { scripts: scriptsWith('UNDEPLOY', { script: 'return 22;' }) });
    });

    it('empties the script that is null and keeps the others', async () => {
      await expectOnly({ scripts: { postprocessor: null } }, { scripts: scriptsWith('POSTPROCESSOR', { script: '' }) });
    });

    it('changes the language of a script and keeps the script', async () => {
      await expectOnly({ scripts: { languages: { preprocessor: 'JAVASCRIPT' } } }, { scripts: scriptsWith('PREPROCESSOR', { language: 'JAVASCRIPT' }) });
    });

    it('changes a script and its language together', async () => {
      await expectOnly({ scripts: { deploy: 'return 11;', languages: { deploy: 'JAVASCRIPT' } } }, { scripts: scriptsWith('DEPLOY', { script: 'return 11;', language: 'JAVASCRIPT' }) });
    });

    it('keeps every script when the request has none', async () => {
      await expectOnly({ scripts: {} }, {});
    });

    const named = (): Record<string, unknown> => {
      const { id, name, enabled, connectorType, properties } = before.destinations[0]!;
      return { id, name, enabled, connectorType, properties };
    };

    it('keeps the settings of a destination that the request leaves out, its filter and its transformer', async () => {
      await expectOnly({ destinations: [named()] }, {});
    });

    it.each([
      ['queueMode', 'ALWAYS'], ['retryCount', 0], ['retryIntervalMs', 10_000], ['rotateQueue', false], ['queueThreadCount', 1], ['waitForPrevious', false],
      ['responseTransformer', null], ['responseTransformerLanguage', 'JAVASCRIPT'],
    ])('changes the %s of a destination and keeps the rest', async (key, value) => {
      await expectOnly({ destinations: [{ ...named(), [key]: value }] }, { destinations: [{ ...before.destinations[0], [key]: value }] });
    });

    it('gives a new destination the defaults of one in a new channel', async () => {
      const added = { name: 'Clinic', enabled: true, connectorType: 'JAVASCRIPT', properties: { script: 'return 2;' } };
      await expectOnly({ destinations: [named(), { id: 'new-1', ...added }] }, {
        destinations: [before.destinations[0], {
          ...added, id: expect.any(String) as string, metaDataId: 2,
          queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10_000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
          responseTransformer: null, responseTransformerLanguage: 'JAVASCRIPT',
        }],
      });
    });

    it('lets someone who may not deploy rename a channel that is enabled', async () => {
      const developer = await userWithRole(mods.pool, 'developer', null);
      users.push(developer.id);
      const name = `itest-400-${randomUUID()}`;
      await expectOnly({ name }, { name }, developer.token);
    });

    // Deploy skips a JavaScript rule or step that has no script.
    it.each(['filters', 'transformers'] as const)('refuses %s with a script left out, and changes nothing', async (key) => {
      const part = key === 'filters' ? 'rules' : 'steps';
      const lists = before[key].map((entry) => ({ ...entry, [part]: (entry[part] as ReadonlyArray<Record<string, unknown>>).map(({ script: _script, ...rest }) => rest) }));
      expect((await apiCall(base, admin, 'PUT', `/channels/${before.id}`, { revision: before.revision, [key]: lists })).status).toBe(400);
      expect(await read(before.id)).toEqual(before);
    });

    it('takes the lists of a channel as a read returns them', async () => {
      const { destinations, metadataColumns, filters, transformers } = before;
      await call('PUT', `/channels/${before.id}`, { revision: before.revision, destinations, metadataColumns, filters, transformers });
      const ids = { id: expect.any(String) as string };
      const same = (entry: Record<string, unknown>): Record<string, unknown> => ({ ...entry, ...ids });
      const after = await read(before.id);
      expect(after.destinations).toEqual(destinations);
      expect(after.metadataColumns).toEqual(metadataColumns.map(same));
      expect(after.filters).toEqual(filters.map((f) => ({ ...same(f), rules: (f['rules'] as Record<string, unknown>[]).map(same) })));
      expect(after.transformers).toEqual(transformers.map((t) => ({ ...same(t), steps: (t['steps'] as Record<string, unknown>[]).map(same) })));
    });
  });

  describe('of an alert', () => {
    let before: Alert;

    const read = (id: string): Promise<Alert> => call<Alert>('GET', `/alerts/${id}`);

    beforeEach(async () => {
      const channel = await call<Channel>('POST', '/channels', {
        name: `itest-400-${randomUUID()}`, inboundDataType: 'RAW', outboundDataType: 'RAW', sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      });
      const { id } = await call<Alert>('POST', '/alerts', {
        name: `itest-400-${randomUUID()}`, description: 'Wakes someone', enabled: false,
        trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'timeout' }, channelIds: [channel.id],
        actions: [{ type: 'EMAIL', recipients: ['oncall@example.test'] }],
        subjectTemplate: 'Down', bodyTemplate: 'Look', reAlertIntervalMs: 60_000, maxAlerts: 5,
      });
      before = await read(id);
      return async () => {
        await call('DELETE', `/alerts/${id}`);
        await deleteTestChannel(mods, channel.id);
      };
    });

    it.each([
      ['name', `itest-400-${randomUUID()}`], ['description', ''], ['enabled', true], ['subjectTemplate', null], ['bodyTemplate', null], ['reAlertIntervalMs', null], ['maxAlerts', null],
    ])('changes the %s and keeps the rest', async (key, value) => {
      await call('PUT', `/alerts/${before.id}`, { revision: before.revision, [key]: value });
      expect(await read(before.id)).toEqual({ ...before, [key]: value, revision: before.revision + 1, updatedAt: expect.any(String) as string });
    });

    it('refuses an error trigger without its regex, which would alert on every error, and changes nothing', async () => {
      const answer = await apiCall(base, admin, 'PUT', `/alerts/${before.id}`, { revision: before.revision, trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'] } });
      expect(answer.status).toBe(400);
      expect(await read(before.id)).toEqual(before);
    });
  });

  describe('of a setting', () => {
    const PASSWORD = { type: 'password', description: 'For the lab', category: 'extensions' };
    let key: string;

    const stored = async (): Promise<unknown> =>
      (await mods.pool.query('SELECT value, type, description, category FROM system_settings WHERE key = $1', [key])).rows[0];

    beforeEach(async () => {
      key = `itest.${randomUUID()}`;
      await call('PUT', `/settings/${key}`, { key, value: 'first', ...PASSWORD });
      return async () => { await mods.pool.query('DELETE FROM system_settings WHERE key = $1', [key]); };
    });

    it('changes the value and keeps the rest, so a password stays masked', async () => {
      await call('PUT', `/settings/${key}`, { key, value: 'second' });
      expect(await stored()).toEqual({ value: 'second', ...PASSWORD });
      expect(await call('GET', `/settings/${key}`)).toMatchObject({ key, value: '__REDACTED__' });
    });

    it('does so for several at once', async () => {
      await call('PUT', '/settings/bulk', { settings: [{ key, value: 'second' }] });
      expect(await stored()).toEqual({ value: 'second', ...PASSWORD });
    });

    it.each([['type', 'string'], ['description', null], ['category', 'lab']])('changes the %s and keeps the rest', async (field, value) => {
      await call('PUT', `/settings/${key}`, { key, value: 'first', [field]: value });
      expect(await stored()).toEqual({ value: 'first', ...PASSWORD, [field]: value });
    });

    it('refuses one without its value, and keeps the stored one', async () => {
      expect((await apiCall(base, admin, 'PUT', `/settings/${key}`, { key, type: 'string' })).status).toBe(400);
      expect(await stored()).toEqual({ value: 'first', ...PASSWORD });
    });

    it('gives a new one the defaults', async () => {
      key = `itest.${randomUUID()}`;
      await call('PUT', `/settings/${key}`, { key, value: 'new' });
      expect(await stored()).toEqual({ value: 'new', type: 'string', description: null, category: 'general' });
    });
  });
});
