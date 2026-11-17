import { describe, expect, it } from 'vitest';
import { KEY_PERMISSIONS, createApiKeySchema, revokeApiKeySchema } from '../api-key.schema.js';

const GROUP = '00000000-0000-4000-8000-000000000001';
const valid = { name: 'Lab feed', permissions: ['channels:read'], groupIds: [GROUP], expiresAt: '2027-01-01T00:00:00Z' };

describe('createApiKeySchema', () => {
  it('accepts a scoped key with an end time', () => {
    expect(createApiKeySchema.parse(valid)).toMatchObject({ ...valid, description: '', reason: null });
  });

  it('refuses identity permissions, which a key may never hold', () => {
    for (const p of ['users:write', 'roles:write', 'api_keys:manage', 'audit:read', 'system:restore']) {
      expect(KEY_PERMISSIONS).not.toContain(p);
      expect(createApiKeySchema.safeParse({ ...valid, permissions: [p] }).success).toBe(false);
    }
  });

  it('requires an end time, a name and at least one permission', () => {
    const { expiresAt: _drop, ...noEnd } = valid;
    expect(createApiKeySchema.safeParse(noEnd).success).toBe(false);
    expect(createApiKeySchema.safeParse({ ...valid, name: ' ' }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ ...valid, permissions: [] }).success).toBe(false);
  });

  it('requires a reason for a key that reads every channel\'s messages', () => {
    const everywhere = { ...valid, groupIds: null, permissions: ['messages:read'] };
    const refused = createApiKeySchema.safeParse(everywhere);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.path).toEqual(['reason']);
    expect(createApiKeySchema.safeParse({ ...everywhere, reason: 'Nightly lab extract' }).success).toBe(true);
    // Scoped, it needs none.
    expect(createApiKeySchema.safeParse({ ...valid, permissions: ['messages:read'] }).success).toBe(true);
  });

  it('refuses repeated permissions or groups, and unknown fields', () => {
    expect(createApiKeySchema.safeParse({ ...valid, permissions: ['channels:read', 'channels:read'] }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ ...valid, groupIds: [GROUP, GROUP] }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ ...valid, secret: 'x' }).success).toBe(false);
  });
});

describe('revokeApiKeySchema', () => {
  it('needs a one-line reason', () => {
    expect(revokeApiKeySchema.safeParse({ reason: 'Leaked in a log' }).success).toBe(true);
    expect(revokeApiKeySchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(revokeApiKeySchema.safeParse({ reason: 'two\nlines' }).success).toBe(false);
  });
});
