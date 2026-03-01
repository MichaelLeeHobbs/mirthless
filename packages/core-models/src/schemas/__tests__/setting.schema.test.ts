// ===========================================
// Setting Schema Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  upsertSettingSchema,
  bulkUpsertSettingsSchema,
  settingsListQuerySchema,
  settingKeyParamSchema,
} from '../setting.schema.js';

// ----- Fixtures -----

const VALID_UPSERT_INPUT = {
  key: 'general.server_name',
  value: 'Production Server',
  type: 'string' as const,
  description: 'The display name of this server instance',
  category: 'general',
};

// ----- upsertSettingSchema -----

describe('upsertSettingSchema', () => {
  it('accepts valid full input', () => {
    const result = upsertSettingSchema.safeParse(VALID_UPSERT_INPUT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.key).toBe('general.server_name');
    expect(result.data.value).toBe('Production Server');
    expect(result.data.type).toBe('string');
  });

  it('applies defaults for optional fields', () => {
    const result = upsertSettingSchema.safeParse({
      key: 'some.setting',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.value).toBeNull();
    expect(result.data.type).toBe('string');
    expect(result.data.description).toBeNull();
    expect(result.data.category).toBe('general');
  });

  it('rejects empty key', () => {
    const result = upsertSettingSchema.safeParse({
      ...VALID_UPSERT_INPUT,
      key: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects key exceeding 255 characters', () => {
    const result = upsertSettingSchema.safeParse({
      ...VALID_UPSERT_INPUT,
      key: 'x'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = upsertSettingSchema.safeParse({
      ...VALID_UPSERT_INPUT,
      type: 'array',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid types', () => {
    for (const type of ['string', 'number', 'boolean', 'json'] as const) {
      const result = upsertSettingSchema.safeParse({ ...VALID_UPSERT_INPUT, type });
      expect(result.success).toBe(true);
    }
  });

  it('accepts null value', () => {
    const result = upsertSettingSchema.safeParse({
      ...VALID_UPSERT_INPUT,
      value: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.value).toBeNull();
  });

  it('rejects category exceeding 100 characters', () => {
    const result = upsertSettingSchema.safeParse({
      ...VALID_UPSERT_INPUT,
      category: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });
});

// ----- bulkUpsertSettingsSchema -----

describe('bulkUpsertSettingsSchema', () => {
  it('accepts array of valid settings', () => {
    const result = bulkUpsertSettingsSchema.safeParse({
      settings: [
        VALID_UPSERT_INPUT,
        { key: 'features.maintenance_mode', value: 'false', type: 'boolean' as const },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.settings).toHaveLength(2);
  });

  it('rejects empty array', () => {
    const result = bulkUpsertSettingsSchema.safeParse({
      settings: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing settings field', () => {
    const result = bulkUpsertSettingsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects array with invalid setting', () => {
    const result = bulkUpsertSettingsSchema.safeParse({
      settings: [{ key: '' }],
    });
    expect(result.success).toBe(false);
  });
});

// ----- settingsListQuerySchema -----

describe('settingsListQuerySchema', () => {
  it('accepts empty query (no filter)', () => {
    const result = settingsListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.category).toBeUndefined();
  });

  it('accepts category filter', () => {
    const result = settingsListQuerySchema.safeParse({ category: 'security' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.category).toBe('security');
  });
});

// ----- settingKeyParamSchema -----

describe('settingKeyParamSchema', () => {
  it('accepts valid key', () => {
    const result = settingKeyParamSchema.safeParse({ key: 'general.server_name' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.key).toBe('general.server_name');
  });

  it('rejects empty key', () => {
    const result = settingKeyParamSchema.safeParse({ key: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing key', () => {
    const result = settingKeyParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects key exceeding 255 characters', () => {
    const result = settingKeyParamSchema.safeParse({ key: 'x'.repeat(256) });
    expect(result.success).toBe(false);
  });
});
