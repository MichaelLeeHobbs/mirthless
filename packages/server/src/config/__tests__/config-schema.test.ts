// ===========================================
// Config schema tests
// ===========================================

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { configSchema } from '../index.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/x', JWT_SECRET: 'k'.repeat(40) };

describe('configSchema', () => {
  it('defaults the statement time limit to two minutes and accepts 0 for none', () => {
    expect(configSchema.parse(base).DATABASE_STATEMENT_TIMEOUT_MS).toBe(120_000);
    expect(configSchema.parse({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: '0' }).DATABASE_STATEMENT_TIMEOUT_MS).toBe(0);
  });

  it('rejects a statement time limit that is not a whole number of milliseconds', () => {
    expect(configSchema.safeParse({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: 'soon' }).success).toBe(false);
    expect(configSchema.safeParse({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: '-1' }).success).toBe(false);
  });

  it('accepts an API rate limit and rejects one that the limiter would ignore', () => {
    expect(configSchema.parse(base).API_RATE_LIMIT_MAX).toBeUndefined();
    expect(configSchema.parse({ ...base, API_RATE_LIMIT_MAX: '2000' }).API_RATE_LIMIT_MAX).toBe(2000);
    for (const bad of ['lots', '0', '-5', '1.5']) {
      expect(configSchema.safeParse({ ...base, API_RATE_LIMIT_MAX: bad }).success).toBe(false);
    }
  });

  it('turns File connectors off when FILE_CONNECTOR_ROOTS is unset', () => {
    expect(configSchema.parse(base).FILE_CONNECTOR_ROOTS).toEqual([]);
  });

  it('reads FILE_CONNECTOR_ROOTS as a comma separated list of absolute paths', () => {
    const a = path.resolve('/srv/galvanigraph/in');
    const b = path.resolve('/srv/galvanigraph/out');
    expect(configSchema.parse({ ...base, FILE_CONNECTOR_ROOTS: ` ${a}, ${b} ,` }).FILE_CONNECTOR_ROOTS).toEqual([a, b]);
  });

  it('refuses a relative FILE_CONNECTOR_ROOTS entry, which would depend on where the server starts', () => {
    expect(configSchema.safeParse({ ...base, FILE_CONNECTOR_ROOTS: './files' }).success).toBe(false);
  });
});
