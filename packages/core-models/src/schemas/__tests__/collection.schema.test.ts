// ===========================================
// Collection Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  createCollectionSchema,
  updateCollectionSchema,
  storeRecordSchema,
  findRecordsSchema,
} from '../collection.schema.js';

describe('createCollectionSchema', () => {
  it('accepts a valid collection definition', () => {
    const result = createCollectionSchema.safeParse({
      name: 'orders',
      indexedFields: ['accessionNumber', 'institutionName', 'orderControl'],
      defaultTtlSeconds: 604_800,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBe('');
  });

  it('defaults defaultTtlSeconds to null (never expire)', () => {
    const result = createCollectionSchema.safeParse({ name: 'lookup', indexedFields: ['code'] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.defaultTtlSeconds).toBeNull();
  });

  it('rejects an empty indexedFields list', () => {
    const result = createCollectionSchema.safeParse({ name: 'x', indexedFields: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a field name that is not a safe identifier', () => {
    const result = createCollectionSchema.safeParse({ name: 'x', indexedFields: ['bad name!'] });
    expect(result.success).toBe(false);
  });

  it('rejects a field name starting with a digit', () => {
    const result = createCollectionSchema.safeParse({ name: 'x', indexedFields: ['1field'] });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive defaultTtlSeconds', () => {
    const result = createCollectionSchema.safeParse({ name: 'x', indexedFields: ['a'], defaultTtlSeconds: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = createCollectionSchema.safeParse({ name: '', indexedFields: ['a'] });
    expect(result.success).toBe(false);
  });
});

describe('updateCollectionSchema', () => {
  it('accepts a partial update', () => {
    const result = updateCollectionSchema.safeParse({ description: 'updated' });
    expect(result.success).toBe(true);
  });

  it('accepts nulling the TTL', () => {
    const result = updateCollectionSchema.safeParse({ defaultTtlSeconds: null });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid field name on update', () => {
    const result = updateCollectionSchema.safeParse({ indexedFields: ['ok', 'not ok'] });
    expect(result.success).toBe(false);
  });
});

describe('storeRecordSchema', () => {
  it('accepts fields + payload', () => {
    const result = storeRecordSchema.safeParse({
      fields: { accessionNumber: 'A1', institutionName: 'Valor', orderControl: 'NW' },
      payload: 'MSH|...',
    });
    expect(result.success).toBe(true);
  });

  it('accepts scalar field values of mixed types', () => {
    const result = storeRecordSchema.safeParse({
      fields: { code: 42, active: true, name: 'x' },
      payload: '{}',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an explicit expireAt override', () => {
    const result = storeRecordSchema.safeParse({
      fields: { a: '1' },
      payload: 'p',
      expireAt: '2026-08-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a ttlSeconds override', () => {
    const result = storeRecordSchema.safeParse({ fields: { a: '1' }, payload: 'p', ttlSeconds: 3600 });
    expect(result.success).toBe(true);
  });

  it('rejects a non-string payload', () => {
    const result = storeRecordSchema.safeParse({ fields: { a: '1' }, payload: { not: 'a string' } });
    expect(result.success).toBe(false);
  });

  it('rejects a negative ttlSeconds', () => {
    const result = storeRecordSchema.safeParse({ fields: { a: '1' }, payload: 'p', ttlSeconds: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO expireAt', () => {
    const result = storeRecordSchema.safeParse({ fields: { a: '1' }, payload: 'p', expireAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});

describe('findRecordsSchema', () => {
  it('defaults match to {} and latest to false', () => {
    const result = findRecordsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.match).toEqual({});
    expect(result.data.latest).toBe(false);
    expect(result.data.order).toBe('desc');
  });

  it('accepts a match plus a scalar and array filter (multiple fields)', () => {
    const result = findRecordsSchema.safeParse({
      match: { accessionNumber: 'A1', institutionName: 'Valor' },
      filter: { orderControl: ['XO', 'NW', 'SC'], messageCode: 'ORM' },
      latest: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty IN-list in a filter', () => {
    const result = findRecordsSchema.safeParse({ filter: { orderControl: [] } });
    expect(result.success).toBe(false);
  });

  it('rejects a limit over 1000', () => {
    const result = findRecordsSchema.safeParse({ limit: 1001 });
    expect(result.success).toBe(false);
  });

  it('rejects a bad order value', () => {
    const result = findRecordsSchema.safeParse({ order: 'sideways' });
    expect(result.success).toBe(false);
  });
});
