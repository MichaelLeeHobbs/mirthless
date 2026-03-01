// ===========================================
// Alert Schema Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  createAlertSchema,
  updateAlertSchema,
  alertActionInputSchema,
  alertListQuerySchema,
  alertUuidParamSchema,
  patchAlertEnabledSchema,
  alertTriggerSchema,
} from '../alert.schema.js';

// ----- Fixtures -----

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const VALID_TRIGGER = {
  type: 'CHANNEL_ERROR' as const,
  errorTypes: ['ANY'] as const,
  regex: null,
};

const VALID_CREATE_INPUT = {
  name: 'Error Alert',
  description: 'Alerts on channel errors',
  enabled: true,
  trigger: VALID_TRIGGER,
  channelIds: [VALID_UUID],
  actions: [
    { type: 'EMAIL' as const, recipients: ['admin@hospital.org'] },
  ],
  subjectTemplate: 'Error in ${channelName}',
  bodyTemplate: 'Error details: ${error}',
  reAlertIntervalMs: 60000,
  maxAlerts: 10,
};

// ----- alertTriggerSchema -----

describe('alertTriggerSchema', () => {
  it('accepts valid CHANNEL_ERROR trigger', () => {
    const result = alertTriggerSchema.safeParse(VALID_TRIGGER);
    expect(result.success).toBe(true);
  });

  it('accepts multiple error types', () => {
    const result = alertTriggerSchema.safeParse({
      type: 'CHANNEL_ERROR',
      errorTypes: ['SOURCE_CONNECTOR', 'DESTINATION_CONNECTOR', 'SOURCE_FILTER'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty errorTypes array', () => {
    const result = alertTriggerSchema.safeParse({
      type: 'CHANNEL_ERROR',
      errorTypes: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid trigger type', () => {
    const result = alertTriggerSchema.safeParse({
      type: 'INVALID_TYPE',
      errorTypes: ['ANY'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid error event type', () => {
    const result = alertTriggerSchema.safeParse({
      type: 'CHANNEL_ERROR',
      errorTypes: ['NONEXISTENT_EVENT'],
    });
    expect(result.success).toBe(false);
  });

  it('defaults regex to null', () => {
    const result = alertTriggerSchema.safeParse({
      type: 'CHANNEL_ERROR',
      errorTypes: ['ANY'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.regex).toBeNull();
  });

  it('accepts regex string', () => {
    const result = alertTriggerSchema.safeParse({
      type: 'CHANNEL_ERROR',
      errorTypes: ['ANY'],
      regex: 'timeout|connection refused',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.regex).toBe('timeout|connection refused');
  });
});

// ----- alertActionInputSchema -----

describe('alertActionInputSchema', () => {
  it('accepts valid EMAIL action', () => {
    const result = alertActionInputSchema.safeParse({
      type: 'EMAIL',
      recipients: ['admin@hospital.org'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts EMAIL with multiple recipients', () => {
    const result = alertActionInputSchema.safeParse({
      type: 'EMAIL',
      recipients: ['admin@hospital.org', 'ops@hospital.org'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects EMAIL with invalid email', () => {
    const result = alertActionInputSchema.safeParse({
      type: 'EMAIL',
      recipients: ['not-an-email'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects EMAIL with empty recipients', () => {
    const result = alertActionInputSchema.safeParse({
      type: 'EMAIL',
      recipients: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid CHANNEL action', () => {
    const result = alertActionInputSchema.safeParse({
      type: 'CHANNEL',
      channelId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects CHANNEL with invalid UUID', () => {
    const result = alertActionInputSchema.safeParse({
      type: 'CHANNEL',
      channelId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown action type', () => {
    const result = alertActionInputSchema.safeParse({
      type: 'SMS',
      recipients: ['1234567890'],
    });
    expect(result.success).toBe(false);
  });
});

// ----- createAlertSchema -----

describe('createAlertSchema', () => {
  it('accepts valid full input', () => {
    const result = createAlertSchema.safeParse(VALID_CREATE_INPUT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('Error Alert');
    expect(result.data.trigger.type).toBe('CHANNEL_ERROR');
    expect(result.data.actions).toHaveLength(1);
  });

  it('applies defaults for optional fields', () => {
    const result = createAlertSchema.safeParse({
      name: 'Minimal Alert',
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'] },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBe('');
    expect(result.data.enabled).toBe(true);
    expect(result.data.channelIds).toEqual([]);
    expect(result.data.actions).toEqual([]);
    expect(result.data.subjectTemplate).toBeNull();
    expect(result.data.bodyTemplate).toBeNull();
    expect(result.data.reAlertIntervalMs).toBeNull();
    expect(result.data.maxAlerts).toBeNull();
  });

  it('rejects empty name', () => {
    const result = createAlertSchema.safeParse({
      ...VALID_CREATE_INPUT,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 255 characters', () => {
    const result = createAlertSchema.safeParse({
      ...VALID_CREATE_INPUT,
      name: 'x'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channelId UUID', () => {
    const result = createAlertSchema.safeParse({
      ...VALID_CREATE_INPUT,
      channelIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative reAlertIntervalMs', () => {
    const result = createAlertSchema.safeParse({
      ...VALID_CREATE_INPUT,
      reAlertIntervalMs: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero maxAlerts', () => {
    const result = createAlertSchema.safeParse({
      ...VALID_CREATE_INPUT,
      maxAlerts: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer maxAlerts', () => {
    const result = createAlertSchema.safeParse({
      ...VALID_CREATE_INPUT,
      maxAlerts: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// ----- updateAlertSchema -----

describe('updateAlertSchema', () => {
  it('accepts partial update with revision', () => {
    const result = updateAlertSchema.safeParse({
      name: 'Updated Name',
      revision: 1,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('Updated Name');
    expect(result.data.revision).toBe(1);
  });

  it('requires revision', () => {
    const result = updateAlertSchema.safeParse({
      name: 'Updated Name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive revision', () => {
    const result = updateAlertSchema.safeParse({
      name: 'test',
      revision: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative revision', () => {
    const result = updateAlertSchema.safeParse({
      name: 'test',
      revision: -1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts full update payload', () => {
    const result = updateAlertSchema.safeParse({
      ...VALID_CREATE_INPUT,
      revision: 2,
    });
    expect(result.success).toBe(true);
  });
});

// ----- alertListQuerySchema -----

describe('alertListQuerySchema', () => {
  it('applies defaults', () => {
    const result = alertListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(25);
  });

  it('coerces string values', () => {
    const result = alertListQuerySchema.safeParse({ page: '3', pageSize: '50' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(3);
    expect(result.data.pageSize).toBe(50);
  });

  it('rejects pageSize over 100', () => {
    const result = alertListQuerySchema.safeParse({ pageSize: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive page', () => {
    const result = alertListQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });
});

// ----- alertUuidParamSchema -----

describe('alertUuidParamSchema', () => {
  it('accepts valid UUID', () => {
    const result = alertUuidParamSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const result = alertUuidParamSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = alertUuidParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ----- patchAlertEnabledSchema -----

describe('patchAlertEnabledSchema', () => {
  it('accepts boolean enabled', () => {
    expect(patchAlertEnabledSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(patchAlertEnabledSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('rejects missing enabled', () => {
    const result = patchAlertEnabledSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    const result = patchAlertEnabledSchema.safeParse({ enabled: 'yes' });
    expect(result.success).toBe(false);
  });
});
