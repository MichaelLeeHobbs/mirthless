// #358, D-332: the alert email password is sent only to the server it was typed for.

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { UpsertSettingInput } from '@galvanigraph/core-models';
import { describeIntegration, loadServerModules, type ServerModules } from './_setup.js';

const KEYS = ['smtp.host', 'smtp.auth_pass'] as const;

describeIntegration('the stored SMTP password (real Postgres)', () => {
  let mods: ServerModules;
  let Settings: typeof import('../../src/services/settings.service.js').SettingsService;
  let before: Array<{ key: string; value: string | null; type: string; description: string | null; category: string | null }> = [];

  const setting = (key: string, value: string | null, type: UpsertSettingInput['type'] = 'string'): UpsertSettingInput =>
    ({ key, value, type, description: null, category: 'smtp' });
  const host = (value: string | null): UpsertSettingInput => setting('smtp.host', value);
  const password = (value: string): UpsertSettingInput => setting('smtp.auth_pass', value, 'password');

  async function storedPassword(): Promise<string | null | undefined> {
    const { rows } = await mods.pool.query<{ value: string | null }>("SELECT value FROM system_settings WHERE key = 'smtp.auth_pass'");
    return rows[0]?.value;
  }

  async function putBack(): Promise<void> {
    await mods.pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [KEYS]);
    for (const s of before) {
      await mods.pool.query('INSERT INTO system_settings (key, value, type, description, category) VALUES ($1, $2, $3, $4, $5)', [s.key, s.value, s.type, s.description, s.category]);
    }
  }

  beforeAll(async () => {
    mods = await loadServerModules();
    ({ SettingsService: Settings } = await import('../../src/services/settings.service.js'));
    before = (await mods.pool.query<(typeof before)[number]>('SELECT key, value, type, description, category FROM system_settings WHERE key = ANY($1)', [KEYS])).rows;
  });

  beforeEach(async () => {
    await mods.pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [KEYS]);
    const saved = await Settings.bulkUpsert([host('mail.example.test'), password('hunter2')]);
    expect(saved.ok).toBe(true);
    expect(await storedPassword()).toBe('hunter2');
  });

  afterAll(async () => {
    await putBack();
    await mods.pool.end();
  });

  it.each([
    ['one save', () => Settings.upsert(host('evil.example.test'))],
    ['a bulk save', () => Settings.bulkUpsert([setting('smtp.from', 'a@example.test'), host('evil.example.test')])],
    ['a bulk save that also sends the old host', () => Settings.bulkUpsert([host('mail.example.test'), host('evil.example.test')])],
    ['emptying it', () => Settings.upsert(host(''))],
    ['deleting it', () => Settings.delete('smtp.host')],
  ] as const)('is cleared when %s changes the host', async (_name, change) => {
    expect((await change()).ok).toBe(true);

    expect(await storedPassword()).toBe('');
  });

  it('is cleared when a host is set where none was, so deleting the host first gets nothing', async () => {
    await mods.pool.query("DELETE FROM system_settings WHERE key = 'smtp.host'");

    expect((await Settings.upsert(host('evil.example.test'))).ok).toBe(true);

    expect(await storedPassword()).toBe('');
  });

  it.each([
    ['the same host is saved', () => Settings.upsert(host('mail.example.test'))],
    ['another SMTP setting is saved', () => Settings.bulkUpsert([setting('smtp.port', '587', 'number'), setting('smtp.from', 'a@example.test')])],
  ] as const)('is kept when %s', async (_name, save) => {
    expect((await save()).ok).toBe(true);

    expect(await storedPassword()).toBe('hunter2');
  });

  it.each([[[host('new.example.test'), password('n3w')]], [[password('n3w'), host('new.example.test')]]])('is replaced when the save that changes the host sets a new one', async (inputs) => {
    expect((await Settings.bulkUpsert(inputs)).ok).toBe(true);

    expect(await storedPassword()).toBe('n3w');
  });

  it('is cleared with the host in one transaction, so a failed save leaves both', async () => {
    const tooLong = { ...setting('smtp.from', 'x'), category: 'x'.repeat(300) };

    expect((await Settings.bulkUpsert([host('evil.example.test'), tooLong])).ok).toBe(false);

    expect(await storedPassword()).toBe('hunter2');
    expect(await Settings.getByKey('smtp.host')).toMatchObject({ ok: true, value: { value: 'mail.example.test' } });
  });

  it('records that it was cleared', async () => {
    const { rows: [last] } = await mods.pool.query<{ id: string }>("SELECT coalesce(max(id), 0) AS id FROM events");
    await Settings.upsert(host('evil.example.test'));

    await expect.poll(async () => (await mods.pool.query<{ attributes: unknown }>(
      "SELECT attributes FROM events WHERE id > $1 AND name = 'SETTINGS_CHANGED' AND attributes->>'key' = 'smtp.host'", [last!.id],
    )).rows.map((r) => r.attributes)).toEqual([{ key: 'smtp.host', cleared: 'smtp.auth_pass' }]);
  });
});
