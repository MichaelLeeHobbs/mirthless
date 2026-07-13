// ===========================================
// Data Source Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  createDataSourceSchema,
  updateDataSourceSchema,
  dbQueryInputSchema,
} from '../datasource.schema.js';

describe('createDataSourceSchema', () => {
  const base = { name: 'reporting-db', host: 'db.internal', database: 'reports', user: 'ro', password: 'secret' };

  it('accepts a valid data source and applies defaults', () => {
    const result = createDataSourceSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.driver).toBe('postgres');
    expect(result.data.port).toBe(5432);
    expect(result.data.readOnly).toBe(true); // read-only by default
    expect(result.data.maxConnections).toBe(5);
    expect(result.data.statementTimeoutMs).toBe(30_000);
    expect(result.data.maxRows).toBe(10_000);
    expect(result.data.description).toBe('');
  });

  it('allows opting into read-write', () => {
    const result = createDataSourceSchema.safeParse({ ...base, readOnly: false });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.readOnly).toBe(false);
  });

  it('rejects a non-postgres driver (v1)', () => {
    const result = createDataSourceSchema.safeParse({ ...base, driver: 'mysql' });
    expect(result.success).toBe(false);
  });

  it('requires a password on create', () => {
    const { password: _omit, ...noPass } = base;
    const result = createDataSourceSchema.safeParse(noPass);
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range port', () => {
    expect(createDataSourceSchema.safeParse({ ...base, port: 70_000 }).success).toBe(false);
    expect(createDataSourceSchema.safeParse({ ...base, port: 0 }).success).toBe(false);
  });

  it('rejects an empty name/host/database/user', () => {
    expect(createDataSourceSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(createDataSourceSchema.safeParse({ ...base, host: '' }).success).toBe(false);
    expect(createDataSourceSchema.safeParse({ ...base, database: '' }).success).toBe(false);
    expect(createDataSourceSchema.safeParse({ ...base, user: '' }).success).toBe(false);
  });

  it('rejects maxConnections above the cap', () => {
    expect(createDataSourceSchema.safeParse({ ...base, maxConnections: 51 }).success).toBe(false);
  });
});

describe('updateDataSourceSchema', () => {
  it('accepts a partial update without a password', () => {
    const result = updateDataSourceSchema.safeParse({ description: 'updated', readOnly: false });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.password).toBeUndefined();
  });

  it('accepts a password change', () => {
    expect(updateDataSourceSchema.safeParse({ password: 'rotated' }).success).toBe(true);
  });

  it('rejects an out-of-range statement timeout', () => {
    expect(updateDataSourceSchema.safeParse({ statementTimeoutMs: 50 }).success).toBe(false);
  });
});

describe('dbQueryInputSchema', () => {
  it('accepts sql with params and defaults params to []', () => {
    const result = dbQueryInputSchema.safeParse({ sql: 'SELECT 1' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.params).toEqual([]);
  });

  it('rejects empty sql', () => {
    expect(dbQueryInputSchema.safeParse({ sql: '' }).success).toBe(false);
  });

  it('carries params through', () => {
    const result = dbQueryInputSchema.safeParse({ sql: 'SELECT $1', params: ['a', 1, true] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.params).toEqual(['a', 1, true]);
  });
});
