// ===========================================
// Query Builder Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { prepare } from '../query-builder.js';

describe('prepare', () => {
  it('replaces single placeholder with positional param', () => {
    const result = prepare(
      'SELECT * FROM users WHERE name = ${name}',
      { name: 'John' },
    );

    expect(result.sql).toBe('SELECT * FROM users WHERE name = $1');
    expect(result.params).toEqual(['John']);
  });

  it('replaces multiple different placeholders', () => {
    const result = prepare(
      'INSERT INTO t (a, b) VALUES (${name}, ${age})',
      { name: 'John', age: 30 },
    );

    expect(result.sql).toBe('INSERT INTO t (a, b) VALUES ($1, $2)');
    expect(result.params).toEqual(['John', 30]);
  });

  it('reuses same positional param for duplicate placeholders', () => {
    const result = prepare(
      'SELECT * FROM t WHERE a = ${val} OR b = ${val}',
      { val: 'test' },
    );

    expect(result.sql).toBe('SELECT * FROM t WHERE a = $1 OR b = $1');
    expect(result.params).toEqual(['test']);
  });

  it('handles template with no placeholders', () => {
    const result = prepare('SELECT 1', {});

    expect(result.sql).toBe('SELECT 1');
    expect(result.params).toEqual([]);
  });

  it('passes undefined for missing context variables', () => {
    const result = prepare(
      'INSERT INTO t (a) VALUES (${missing})',
      {},
    );

    expect(result.sql).toBe('INSERT INTO t (a) VALUES ($1)');
    expect(result.params).toEqual([undefined]);
  });

  it('handles null values in context', () => {
    const result = prepare(
      'UPDATE t SET a = ${val} WHERE id = ${id}',
      { val: null, id: 1 },
    );

    expect(result.sql).toBe('UPDATE t SET a = $1 WHERE id = $2');
    expect(result.params).toEqual([null, 1]);
  });

  it('handles numeric values', () => {
    const result = prepare(
      'SELECT * FROM t WHERE count > ${min} AND count < ${max}',
      { min: 0, max: 100 },
    );

    expect(result.sql).toBe('SELECT * FROM t WHERE count > $1 AND count < $2');
    expect(result.params).toEqual([0, 100]);
  });

  it('handles boolean values', () => {
    const result = prepare(
      'UPDATE t SET active = ${active}',
      { active: true },
    );

    expect(result.sql).toBe('UPDATE t SET active = $1');
    expect(result.params).toEqual([true]);
  });

  it('prevents SQL injection by parameterizing all values', () => {
    const malicious = "'; DROP TABLE users; --";
    const result = prepare(
      'SELECT * FROM users WHERE name = ${name}',
      { name: malicious },
    );

    // The SQL should NOT contain the malicious string
    expect(result.sql).toBe('SELECT * FROM users WHERE name = $1');
    expect(result.sql).not.toContain(malicious);
    // The value should be in params, where the driver will safely bind it
    expect(result.params).toEqual([malicious]);
  });

  it('handles complex INSERT with many fields', () => {
    const result = prepare(
      'INSERT INTO messages (channel_id, content, status, created_at) VALUES (${channelId}, ${content}, ${status}, ${createdAt})',
      { channelId: 'ch-1', content: 'msg body', status: 'RECEIVED', createdAt: '2026-01-01' },
    );

    expect(result.sql).toBe(
      'INSERT INTO messages (channel_id, content, status, created_at) VALUES ($1, $2, $3, $4)',
    );
    expect(result.params).toEqual(['ch-1', 'msg body', 'RECEIVED', '2026-01-01']);
  });

  it('handles UPDATE with WHERE clause', () => {
    const result = prepare(
      'UPDATE messages SET processed = true WHERE id = ${id} AND channel_id = ${channelId}',
      { id: 42, channelId: 'ch-1' },
    );

    expect(result.sql).toBe(
      'UPDATE messages SET processed = true WHERE id = $1 AND channel_id = $2',
    );
    expect(result.params).toEqual([42, 'ch-1']);
  });

  it('handles underscored variable names', () => {
    const result = prepare(
      'SELECT * FROM t WHERE my_field = ${my_field}',
      { my_field: 'value' },
    );

    expect(result.sql).toBe('SELECT * FROM t WHERE my_field = $1');
    expect(result.params).toEqual(['value']);
  });

  it('preserves order of params as encountered', () => {
    const result = prepare(
      'INSERT INTO t (c, b, a) VALUES (${c}, ${b}, ${a})',
      { a: 1, b: 2, c: 3 },
    );

    expect(result.sql).toBe('INSERT INTO t (c, b, a) VALUES ($1, $2, $3)');
    // params are in order of first encounter in the template, not context key order
    expect(result.params).toEqual([3, 2, 1]);
  });
});
