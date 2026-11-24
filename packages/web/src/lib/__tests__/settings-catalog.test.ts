import { describe, it, expect } from 'vitest';
import { upsertSettingSchema } from '@galvanigraph/core-models';
import { fieldFor, groupSettings, isSecret, settingTypeForSave, validateSetting, SETTING_SECTIONS } from '../settings-catalog.js';

// A row's stored type can be any string up to 20 characters; the save API takes
// five lowercase names. Sending the stored type as is made the whole bulk save 400.
describe('settingTypeForSave', () => {
  it.each([
    ['string', 'string'], ['number', 'number'], ['boolean', 'boolean'], ['json', 'json'], ['password', 'password'],
    ['Password', 'password'], ['PASSWORD', 'password'], ['secret', 'password'], ['Secret', 'password'], ['Number', 'number'],
  ])('sends %s as %s, which the save schema accepts', (stored, sent) => {
    expect(settingTypeForSave(stored)).toBe(sent);
    expect(upsertSettingSchema.safeParse({ key: 'k', value: 'v', type: settingTypeForSave(stored) }).success).toBe(true);
  });

  it('keeps a secret row secret on the server after the save', () => {
    expect(isSecret('custom.api', settingTypeForSave('secret'))).toBe(true);
  });
});

describe('groupSettings', () => {
  it('puts settings in catalog sections, in catalog order, whatever order the server sends', () => {
    const groups = groupSettings([{ key: 'smtp.port' }, { key: 'general.server_name' }, { key: 'smtp.host' }]);
    expect(groups.map((g) => g.section.id)).toEqual(['general', 'email']);
    expect(groups[1]?.settings.map((s) => s.key)).toEqual(['smtp.host', 'smtp.port']);
  });

  it('shows settings the catalog does not list under Other instead of hiding them', () => {
    const groups = groupSettings([{ key: 'custom.retry_limit' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.section.label).toBe('Other');
  });

  it('returns nothing for no settings', () => {
    expect(groupSettings([])).toEqual([]);
  });

  it('lists each key once', () => {
    const keys = SETTING_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('fieldFor', () => {
  it('returns the catalog label for a known key', () => {
    expect(fieldFor('smtp.host').label).toBe('SMTP server');
    expect(fieldFor('smtp.require_tls').label).toBe('Require STARTTLS');
  });

  it('makes a readable label from an unknown key', () => {
    expect(fieldFor('custom.retry_limit')).toEqual({ key: 'custom.retry_limit', label: 'Retry limit', help: '' });
    expect(fieldFor('plainkey').label).toBe('Plainkey');
  });
});

describe('isSecret', () => {
  it('treats password-typed and secret-looking keys as secrets', () => {
    expect(isSecret('anything', 'password')).toBe(true);
    expect(isSecret('smtp.auth_pass', 'string')).toBe(true);
    expect(isSecret('api.token', 'string')).toBe(true);
    expect(isSecret('smtp.host', 'string')).toBe(false);
  });

  it('treats a setting typed secret, or Password in any case, as a secret like the server does', () => {
    expect(isSecret('custom.value', 'secret')).toBe(true);
    expect(isSecret('custom.value', 'Password')).toBe(true);
    expect(isSecret('custom.value', 'SECRET')).toBe(true);
  });
});

describe('validateSetting', () => {
  it('accepts a port in range and rejects one outside it or not whole', () => {
    expect(validateSetting('number', '587', 'port')).toBeNull();
    expect(validateSetting('number', '0', 'port')).toMatch(/1 to 65535/);
    expect(validateSetting('number', '70000', 'port')).toMatch(/1 to 65535/);
    expect(validateSetting('number', '25.5', 'port')).toMatch(/1 to 65535/);
  });

  it('keeps audit retention at six whole years or more', () => {
    expect(validateSetting('number', '6', 'retentionYears')).toBeNull();
    expect(validateSetting('number', '10', 'retentionYears')).toBeNull();
    expect(validateSetting('number', '5', 'retentionYears')).toMatch(/at least 6/);
    expect(validateSetting('number', '6.5', 'retentionYears')).toMatch(/at least 6/);
    expect(validateSetting('number', '', 'retentionYears')).toBe('Enter a number.');
  });

  it('requires a number for a number setting', () => {
    expect(validateSetting('number', '', undefined)).toBe('Enter a number.');
    expect(validateSetting('number', 'abc', undefined)).toBe('Enter a number.');
    expect(validateSetting('number', '-3.5', undefined)).toBeNull();
  });

  it('allows an empty email but rejects a malformed one', () => {
    expect(validateSetting('string', '', 'email')).toBeNull();
    expect(validateSetting('string', 'ops@hospital.example', 'email')).toBeNull();
    expect(validateSetting('string', 'ops@', 'email')).toBe('Enter an email address.');
  });

  it('checks cron field count and syntax', () => {
    expect(validateSetting('string', '0 3 * * *', 'cron')).toBeNull();
    expect(validateSetting('string', '*/15 0-6 * JAN-MAR MON', 'cron')).toBeNull();
    expect(validateSetting('string', '0 3 * *', 'cron')).toMatch(/5 fields/);
    expect(validateSetting('string', '0 3 * * * * *', 'cron')).toMatch(/5 fields/);
    expect(validateSetting('string', '0 3 * * banana!', 'cron')).toMatch(/not valid/);
  });

  it('checks JSON parses, allowing empty', () => {
    expect(validateSetting('json', '{"a":1}')).toBeNull();
    expect(validateSetting('json', '')).toBeNull();
    expect(validateSetting('json', '{a:1}')).toBe('Not valid JSON.');
  });

  it('accepts any plain string', () => {
    expect(validateSetting('string', 'anything')).toBeNull();
  });
});
