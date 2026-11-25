import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { configSchema, validatedConfigSchema } from '../index.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/x', JWT_SECRET: 'k'.repeat(40) };

const PRODUCTION = {
  NODE_ENV: 'production',
  PORT: '8080',
  FRONTEND_URL: 'https://galvanigraph.example.com',
  DATABASE_URL: 'postgresql://user:pass@db:5432/galvanigraph',
  DATABASE_SSL: 'true',
  JWT_SECRET: 'a-very-long-secret-string-that-is-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '5m',
  JWT_REFRESH_EXPIRES_IN: '1d',
  TRUST_PROXY: 'true',
  LOG_LEVEL: 'warn',
};

/** The variables the schema refuses, so a refusal for some other reason does not pass for the one meant. */
const refused = (env: Readonly<Record<string, string | undefined>>): readonly unknown[] =>
  (configSchema.safeParse(env).error?.issues ?? []).map((i) => i.path[0]);

describe('configSchema', () => {
  it('accepts a production environment and reads each variable as the server uses it', () => {
    expect(validatedConfigSchema.parse(PRODUCTION)).toMatchObject({ ...PRODUCTION, PORT: 8080, DATABASE_SSL: true, TRUST_PROXY: true });
  });

  it('applies the defaults when only the database and the JWT secret are set', () => {
    expect(configSchema.parse(base)).toMatchObject({
      ...base,
      NODE_ENV: 'development',
      PORT: 3000,
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_SSL: false,
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      TRUST_PROXY: false,
      LOG_LEVEL: 'info',
    });
  });

  it('refuses a missing database or JWT secret', () => {
    expect(refused({ ...base, DATABASE_URL: undefined })).toEqual(['DATABASE_URL']);
    expect(refused({ ...base, JWT_SECRET: undefined })).toEqual(['JWT_SECRET']);
  });

  it('refuses a JWT secret shorter than 32 characters', () => {
    expect(refused({ ...base, JWT_SECRET: 'k'.repeat(31) })).toEqual(['JWT_SECRET']);
    expect(refused({ ...base, JWT_SECRET: 'k'.repeat(32) })).toEqual([]);
  });

  it.each(['DATABASE_URL', 'FRONTEND_URL'])('refuses a %s that is not a URL', (name) => {
    expect(refused({ ...base, [name]: 'not-a-url' })).toEqual([name]);
  });

  it.each([
    ['NODE_ENV', ['development', 'production', 'test'], 'staging'],
    ['LOG_LEVEL', ['debug', 'info', 'warn', 'error'], 'trace'],
  ] as const)('keeps each listed %s and refuses any other', (name, listed, unlisted) => {
    expect(listed.map((value) => configSchema.parse({ ...base, [name]: value })[name])).toEqual(listed);
    expect(refused({ ...base, [name]: unlisted })).toEqual([name]);
  });

  it('reads DATABASE_SSL as a boolean and refuses anything but true and false', () => {
    expect(configSchema.parse({ ...base, DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true);
    expect(configSchema.parse({ ...base, DATABASE_SSL: 'false' }).DATABASE_SSL).toBe(false);
    expect(refused({ ...base, DATABASE_SSL: 'yes' })).toEqual(['DATABASE_SSL']);
  });

  it('reads PORT as a number and refuses one that is not', () => {
    expect(configSchema.parse({ ...base, PORT: '8080' }).PORT).toBe(8080);
    expect(refused({ ...base, PORT: 'http' })).toEqual(['PORT']);
  });

  it('defaults the statement time limit to two minutes and accepts 0 for none', () => {
    expect(configSchema.parse(base).DATABASE_STATEMENT_TIMEOUT_MS).toBe(120_000);
    expect(configSchema.parse({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: '0' }).DATABASE_STATEMENT_TIMEOUT_MS).toBe(0);
  });

  it('rejects a statement time limit that is not a whole number of milliseconds', () => {
    expect(configSchema.safeParse({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: 'soon' }).success).toBe(false);
    expect(configSchema.safeParse({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: '-1' }).success).toBe(false);
  });

  it('waits 5 seconds for a connection unless told otherwise', () => {
    expect(configSchema.parse(base).DATABASE_CONNECT_TIMEOUT_MS).toBe(5_000);
    expect(configSchema.parse({ ...base, DATABASE_CONNECT_TIMEOUT_MS: '60000' }).DATABASE_CONNECT_TIMEOUT_MS).toBe(60_000);
  });

  it('rejects a connection time limit that is none, or that a timer cannot keep', () => {
    for (const bad of ['0', '-1', '1.5', 'soon', '2147483648']) {
      expect(refused({ ...base, DATABASE_CONNECT_TIMEOUT_MS: bad })).toEqual(['DATABASE_CONNECT_TIMEOUT_MS']);
    }
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
