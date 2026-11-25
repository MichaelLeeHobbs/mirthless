// An update keeps what the request leaves out (#400, D-359).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiCall, closeServer, deleteTestChannel, describeIntegration, listen, loadServerModules, userWithRole, type ServerModules } from './_setup.js';

type Json = Readonly<Record<string, unknown>>;
interface Script { readonly scriptType: string; readonly script: string; readonly language: string }
interface Channel {
  readonly id: string;
  readonly revision: number;
  readonly scripts: readonly Script[];
  readonly destinations: ReadonlyArray<Json & { readonly id: string }>;
  readonly metadataColumns: readonly Json[];
  readonly filters: ReadonlyArray<Json & { readonly rules: readonly Json[] }>;
  readonly transformers: ReadonlyArray<Json & { readonly steps: readonly Json[] }>;
}
interface Alert { readonly id: string; readonly revision: number }

// None of it is the default, or a field put back to its default would look kept.
const FIELDS = { description: 'Results to the clinic', enabled: true, responseMode: 'DESTINATION', responseConnectorName: 'Lab' };
const PROPERTIES = {
  initialState: 'PAUSED', messageStorageMode: 'PRODUCTION', encryptData: true, removeContentOnCompletion: true, removeAttachmentsOnCompletion: true,
  pruningEnabled: true, pruningMaxAgeDays: 45, pruningArchiveEnabled: true, scriptTimeoutSeconds: 12,
};
const SCRIPTS = {
  deploy: 'return 1;', undeploy: 'return 2;', preprocessor: 'return message;', postprocessor: 'return 4;',
  languages: { deploy: 'TYPESCRIPT', undeploy: 'TYPESCRIPT', preprocessor: 'TYPESCRIPT', postprocessor: 'TYPESCRIPT' },
};
const NAMED = { name: 'Lab', connectorType: 'JAVASCRIPT', properties: { script: 'return 1;' } };
const BARE = { name: 'Clinic', connectorType: 'JAVASCRIPT', properties: { script: 'return 2;' } };
const DESTINATION = {
  ...NAMED, enabled: false, queueMode: 'ON_FAILURE', retryCount: 7, retryIntervalMs: 2500, rotateQueue: true, queueThreadCount: 3, waitForPrevious: true,
  responseTransformer: 'return response;', responseTransformerLanguage: 'TYPESCRIPT',
};
const COLUMN = { name: 'PatientId', dataType: 'STRING', mappingExpression: 'msg.id' };
const RULES = [
  { type: 'JAVASCRIPT', enabled: false, operator: 'OR', name: 'No tests', script: 'return true;', language: 'TYPESCRIPT', field: null, condition: null, values: null },
  { type: 'RULE_BUILDER', enabled: true, operator: 'OR', name: null, script: null, field: 'id', condition: 'EQUALS', values: ['1'] },
];
const STEPS = [
  { type: 'MAPPER', enabled: false, name: 'Id', script: null, sourceField: 'id', targetField: 'a', defaultValue: 'none', mapping: 'COPY' },
  { type: 'JAVASCRIPT', enabled: true, name: null, script: 'msg = msg;', language: 'TYPESCRIPT', sourceField: null, targetField: null, defaultValue: null, mapping: null },
];
const TRANSFORMER = { inboundDataType: 'JSON', outboundDataType: 'XML', inboundProperties: { a: 1 }, outboundProperties: { b: 2 }, inboundTemplate: '{}', outboundTemplate: '<a/>', steps: STEPS };
/** In the order of their types. */
const STORED_SCRIPTS = [['DEPLOY', 'return 1;', 'TYPESCRIPT'], ['POSTPROCESSOR', 'return 4;', 'TYPESCRIPT'], ['PREPROCESSOR', 'return message;', 'TYPESCRIPT'], ['UNDEPLOY', 'return 2;', 'TYPESCRIPT']];
const stored = (scripts: readonly Script[]): unknown[] => scripts.map((s) => [s.scriptType, s.script, s.language]).sort();
const ALERT = { description: 'Wakes someone', enabled: false, subjectTemplate: 'Down', bodyTemplate: 'Look', reAlertIntervalMs: 60_000, maxAlerts: 5 };
const PASSWORD = { type: 'password', description: 'For the lab', category: 'extensions' };

describeIntegration('what an update leaves out (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let admin: string;
  let channelId: string | undefined;
  /** What a new channel makes of a destination that has no settings. */
  let defaults: Json;
  const users: string[] = [];

  async function user(role: string): Promise<string> {
    const made = await userWithRole(mods.pool, role, null);
    users.push(made.id);
    return made.token;
  }

  async function call<T>(method: string, path: string, body?: unknown, token = admin): Promise<T> {
    const answer = await apiCall<T>(base, token, method, path, body);
    expect(answer.status, JSON.stringify(answer.json.error)).toBeLessThan(300);
    return answer.json.data as T;
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    admin = await user('admin');
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
    const { id, scripts, destinations } = await call<Channel>('POST', '/channels', {
      name: `itest-400-${randomUUID()}`, inboundDataType: 'JSON', outboundDataType: 'XML',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
      scripts: SCRIPTS, destinations: [DESTINATION, BARE],
    });
    channelId = id;
    expect(stored(scripts)).toEqual(STORED_SCRIPTS);
    expect(destinations[0]).toMatchObject(DESTINATION);
    defaults = destinations[1]!;
  });

  afterAll(async () => {
    await closeServer(server);
    if (channelId !== undefined) await deleteTestChannel(mods, channelId);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods?.pool.end();
  });

  describe('of a channel', () => {
    let before: Channel;

    async function read(): Promise<Channel> {
      const channel = await call<Channel>('GET', `/channels/${channelId!}`);
      return { ...channel, scripts: [...channel.scripts].sort((a, b) => a.scriptType.localeCompare(b.scriptType)) };
    }

    beforeEach(async () => {
      const { revision, destinations } = await read();
      const { id } = destinations[0]!;
      await call('PUT', `/channels/${channelId!}`, {
        ...FIELDS, revision, properties: PROPERTIES, scripts: SCRIPTS, destinations: [{ ...DESTINATION, id }], metadataColumns: [COLUMN],
        filters: [{ connectorId: id, rules: RULES }], transformers: [{ connectorId: id, ...TRANSFORMER }],
      });
      before = await read();
      expect(before).toMatchObject({
        ...FIELDS, ...PROPERTIES, destinations: [{ ...DESTINATION, id }], metadataColumns: [COLUMN],
        filters: [{ connectorId: id, rules: RULES }], transformers: [{ connectorId: id, ...TRANSFORMER }],
      });
      expect(stored(before.scripts)).toEqual(STORED_SCRIPTS);
    });

    /** The channel after the update, which changes `changed` and nothing else. */
    async function expectOnly(body: Json, changed: Json, token = admin): Promise<void> {
      await call('PUT', `/channels/${channelId!}`, { revision: before.revision, ...body }, token);
      expect(await read()).toEqual({ ...before, ...changed, revision: before.revision + 1, updatedAt: expect.any(String) as string });
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

    // So has one that was imported without its scripts.
    it('stores a script of a channel that has no row for it', async () => {
      await mods.pool.query('DELETE FROM channel_scripts WHERE channel_id = $1', [channelId]);
      await call('PUT', `/channels/${channelId!}`, { revision: before.revision, scripts: { postprocessor: 'return 4;', languages: { deploy: 'TYPESCRIPT' } } });
      expect(stored((await read()).scripts)).toEqual([['DEPLOY', '', 'TYPESCRIPT'], ['POSTPROCESSOR', 'return 4;', 'JAVASCRIPT']]);
    });

    it('keeps the settings of a destination that the request leaves out, its filter and its transformer', async () => {
      await expectOnly({ destinations: [{ ...NAMED, id: before.destinations[0]!.id }] }, {});
    });

    it.each([
      ['enabled', true], ['queueMode', 'ALWAYS'], ['retryCount', 0], ['retryIntervalMs', 10_000], ['rotateQueue', false], ['queueThreadCount', 1], ['waitForPrevious', false],
      ['responseTransformer', null], ['responseTransformerLanguage', 'JAVASCRIPT'],
    ])('changes the %s of a destination and keeps the rest', async (key, value) => {
      const [stays] = before.destinations;
      await expectOnly({ destinations: [{ ...NAMED, id: stays!.id, [key]: value }] }, { destinations: [{ ...stays, [key]: value }] });
    });

    it('gives a new destination the defaults of one in a new channel', async () => {
      const [stays] = before.destinations;
      expect(defaults).toMatchObject({ ...BARE, enabled: true, queueMode: 'NEVER', retryCount: 0, responseTransformer: null });
      await expectOnly({ destinations: [{ ...NAMED, id: stays!.id }, { ...BARE, id: 'new-1' }] }, {
        destinations: [stays, { ...defaults, id: expect.any(String) as string, metaDataId: expect.any(Number) as number }],
      });
    });

    it('refuses a destination whose id has a stray character, rather than put a new one that is on in its place', async () => {
      const answer = await apiCall(base, admin, 'PUT', `/channels/${channelId!}`, { revision: before.revision, destinations: [{ ...NAMED, id: `${before.destinations[0]!.id}\r` }] });
      expect(answer.status).toBe(400);
      expect(await read()).toEqual(before);
    });

    it('lets someone who may not deploy rename a channel that is enabled', async () => {
      const name = `itest-400-${randomUUID()}`;
      await expectOnly({ name }, { name }, await user('developer'));
    });

    // Deploy skips a JavaScript rule or step that has no script.
    it.each([
      ['rule', (): Json => ({ filters: before.filters.map((f) => ({ ...f, rules: f.rules.map(({ script: _script, ...rest }) => rest) })) })],
      ['step', (): Json => ({ transformers: before.transformers.map((t) => ({ ...t, steps: t.steps.map(({ script: _script, ...rest }) => rest) })) })],
    ])('refuses a %s with its script left out, and changes nothing', async (_what, body) => {
      expect((await apiCall(base, admin, 'PUT', `/channels/${channelId!}`, { revision: before.revision, ...body() })).status).toBe(400);
      expect(await read()).toEqual(before);
    });

    it('takes the lists of a channel as a read returns them', async () => {
      const { destinations, metadataColumns, filters, transformers } = before;
      const same = (entry: Json): Json => ({ ...entry, id: expect.any(String) as string });
      await expectOnly({ destinations, metadataColumns, filters, transformers }, {
        metadataColumns: metadataColumns.map(same),
        filters: filters.map((f) => ({ ...same(f), rules: f.rules.map(same) })),
        transformers: transformers.map((t) => ({ ...same(t), steps: t.steps.map(same) })),
      });
    });
  });

  describe('of an alert', () => {
    let before: Alert;

    const read = (id: string): Promise<Alert> => call<Alert>('GET', `/alerts/${id}`);

    beforeEach(async () => {
      const { id } = await call<Alert>('POST', '/alerts', {
        ...ALERT, name: `itest-400-${randomUUID()}`,
        trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'timeout' }, channelIds: [channelId],
        actions: [{ type: 'EMAIL', recipients: ['oncall@example.test'] }],
      });
      before = await read(id);
      expect(before).toMatchObject({ ...ALERT, trigger: { regex: 'timeout' }, channelIds: [channelId], actions: [{ recipients: ['oncall@example.test'] }] });
      return async () => { await call('DELETE', `/alerts/${id}`); };
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
    let key: string;

    const row = async (of = key): Promise<unknown> =>
      (await mods.pool.query('SELECT value, type, description, category FROM system_settings WHERE key = $1', [of])).rows[0];

    beforeEach(async () => {
      key = `itest.${randomUUID()}`;
      await call('PUT', `/settings/${key}`, { key, value: 'first', ...PASSWORD });
      expect(await row()).toEqual({ value: 'first', ...PASSWORD });
      return async () => { await mods.pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [[key, `${key}.new`]]); };
    });

    it('changes the value and keeps the rest, so a password stays masked', async () => {
      await call('PUT', `/settings/${key}`, { key, value: 'second' });
      expect(await row()).toEqual({ value: 'second', ...PASSWORD });
      expect(await call('GET', `/settings/${key}`)).toMatchObject({ key, value: '__REDACTED__' });
    });

    it('does so for several at once', async () => {
      await call('PUT', '/settings/bulk', { settings: [{ key, value: 'second' }, { key: `${key}.new`, value: 'x' }] });
      expect(await row()).toEqual({ value: 'second', ...PASSWORD });
      expect(await row(`${key}.new`)).toEqual({ value: 'x', type: 'string', description: null, category: 'general' });
    });

    it.each([['type', 'string'], ['description', null], ['category', 'lab']])('changes the %s and keeps the rest', async (field, value) => {
      await call('PUT', `/settings/${key}`, { key, value: 'first', [field]: value });
      expect(await row()).toEqual({ value: 'first', ...PASSWORD, [field]: value });
    });

    it('refuses one without its value, and keeps the stored one', async () => {
      expect((await apiCall(base, admin, 'PUT', `/settings/${key}`, { key, type: 'string' })).status).toBe(400);
      expect(await row()).toEqual({ value: 'first', ...PASSWORD });
    });

    it.each(['alone', 'with others'])('refuses a password sent back as a read shows it, %s, and changes nothing', async (how) => {
      const shown = await call<Json>('GET', `/settings/${key}`);
      const answer = how === 'alone'
        ? await apiCall(base, admin, 'PUT', `/settings/${key}`, shown)
        : await apiCall(base, admin, 'PUT', '/settings/bulk', { settings: [{ key: `${key}.new`, value: 'x' }, { key, value: shown['value'] }] });
      expect(answer.status).toBe(400);
      expect(answer.json.error?.message).toContain('__REDACTED__');
      expect([await row(), await row(`${key}.new`)]).toEqual([{ value: 'first', ...PASSWORD }, undefined]);
    });

    it('gives a new one the defaults', async () => {
      await call('PUT', `/settings/${key}.new`, { key: `${key}.new`, value: 'new' });
      expect(await row(`${key}.new`)).toEqual({ value: 'new', type: 'string', description: null, category: 'general' });
    });
  });
});
