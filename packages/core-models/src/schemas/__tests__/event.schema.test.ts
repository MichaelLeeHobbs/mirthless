// ===========================================
// Event Schema Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  eventListQuerySchema,
  eventIdParamSchema,
  createEventInputSchema,
  purgeEventsSchema,
} from '../event.schema.js';

// ----- Fixtures -----

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const VALID_CREATE_INPUT = {
  level: 'INFO' as const,
  name: 'USER_LOGIN',
  outcome: 'SUCCESS' as const,
  userId: VALID_UUID,
  channelId: null,
  serverId: 'server-01',
  ipAddress: '192.168.1.100',
  attributes: { browser: 'Chrome' },
};

// ----- eventListQuerySchema -----

describe('eventListQuerySchema', () => {
  it('applies defaults', () => {
    const result = eventListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(25);
  });

  it('coerces string values for page and pageSize', () => {
    const result = eventListQuerySchema.safeParse({ page: '3', pageSize: '50' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(3);
    expect(result.data.pageSize).toBe(50);
  });

  it('accepts all valid filters', () => {
    const result = eventListQuerySchema.safeParse({
      page: 1,
      pageSize: 25,
      level: 'INFO,WARN',
      name: 'USER_LOGIN,USER_CREATED',
      outcome: 'SUCCESS',
      userId: VALID_UUID,
      channelId: VALID_UUID,
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-12-31T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-positive page', () => {
    const result = eventListQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative page', () => {
    const result = eventListQuerySchema.safeParse({ page: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects pageSize over 100', () => {
    const result = eventListQuerySchema.safeParse({ pageSize: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer page', () => {
    const result = eventListQuerySchema.safeParse({ page: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid userId UUID', () => {
    const result = eventListQuerySchema.safeParse({ userId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channelId UUID', () => {
    const result = eventListQuerySchema.safeParse({ channelId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('accepts optional filters as undefined', () => {
    const result = eventListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.level).toBeUndefined();
    expect(result.data.name).toBeUndefined();
    expect(result.data.outcome).toBeUndefined();
  });
});

// ----- eventIdParamSchema -----

describe('eventIdParamSchema', () => {
  it('accepts valid positive integer', () => {
    const result = eventIdParamSchema.safeParse({ id: 42 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe(42);
  });

  it('coerces string to number', () => {
    const result = eventIdParamSchema.safeParse({ id: '123' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe(123);
  });

  it('rejects zero', () => {
    const result = eventIdParamSchema.safeParse({ id: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative number', () => {
    const result = eventIdParamSchema.safeParse({ id: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric string', () => {
    const result = eventIdParamSchema.safeParse({ id: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = eventIdParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ----- createEventInputSchema -----

describe('createEventInputSchema', () => {
  it('accepts valid full input', () => {
    const result = createEventInputSchema.safeParse(VALID_CREATE_INPUT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.level).toBe('INFO');
    expect(result.data.name).toBe('USER_LOGIN');
    expect(result.data.outcome).toBe('SUCCESS');
    expect(result.data.userId).toBe(VALID_UUID);
    expect(result.data.attributes).toEqual({ browser: 'Chrome' });
  });

  it('applies defaults for nullable fields', () => {
    const result = createEventInputSchema.safeParse({
      level: 'WARN',
      name: 'SETTINGS_CHANGED',
      outcome: 'SUCCESS',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.userId).toBeNull();
    expect(result.data.channelId).toBeNull();
    expect(result.data.serverId).toBeNull();
    expect(result.data.ipAddress).toBeNull();
    expect(result.data.attributes).toBeNull();
  });

  it('rejects invalid level', () => {
    const result = createEventInputSchema.safeParse({
      ...VALID_CREATE_INPUT,
      level: 'DEBUG',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid outcome', () => {
    const result = createEventInputSchema.safeParse({
      ...VALID_CREATE_INPUT,
      outcome: 'PARTIAL',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createEventInputSchema.safeParse({
      ...VALID_CREATE_INPUT,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 100 characters', () => {
    const result = createEventInputSchema.safeParse({
      ...VALID_CREATE_INPUT,
      name: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = createEventInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid userId UUID', () => {
    const result = createEventInputSchema.safeParse({
      ...VALID_CREATE_INPUT,
      userId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all three level values', () => {
    for (const level of ['INFO', 'WARN', 'ERROR'] as const) {
      const result = createEventInputSchema.safeParse({ ...VALID_CREATE_INPUT, level });
      expect(result.success).toBe(true);
    }
  });

  it('accepts both outcome values', () => {
    for (const outcome of ['SUCCESS', 'FAILURE'] as const) {
      const result = createEventInputSchema.safeParse({ ...VALID_CREATE_INPUT, outcome });
      expect(result.success).toBe(true);
    }
  });
});

// ----- purgeEventsSchema -----

describe('purgeEventsSchema', () => {
  it('accepts valid days value', () => {
    const result = purgeEventsSchema.safeParse({ olderThanDays: 90 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.olderThanDays).toBe(90);
  });

  it('coerces string to number', () => {
    const result = purgeEventsSchema.safeParse({ olderThanDays: '30' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.olderThanDays).toBe(30);
  });

  it('rejects zero', () => {
    const result = purgeEventsSchema.safeParse({ olderThanDays: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative value', () => {
    const result = purgeEventsSchema.safeParse({ olderThanDays: -7 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer', () => {
    const result = purgeEventsSchema.safeParse({ olderThanDays: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing field', () => {
    const result = purgeEventsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
