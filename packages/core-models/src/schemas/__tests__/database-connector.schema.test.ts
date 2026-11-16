// ===========================================
// DATABASE Connector Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  databaseSourcePropertiesSchema,
  databaseDestinationPropertiesSchema,
  defaultDatabasePort,
} from '../database-connector.schema.js';

const SOURCE_REQUIRED = { host: 'db', database: 'lab', selectQuery: 'SELECT id FROM o' };
const DESTINATION_REQUIRED = { host: 'db', database: 'lab', query: 'INSERT INTO t (a) VALUES (${mrn})' };

const CONNECTION_DEFAULTS = { username: '', password: '', tls: false };

describe('databaseSourcePropertiesSchema', () => {
  it('needs a host, database and select query, and fills the defaults', () => {
    expect(databaseSourcePropertiesSchema.parse(SOURCE_REQUIRED)).toEqual({
      ...SOURCE_REQUIRED, ...CONNECTION_DEFAULTS, updateQuery: '', updateMode: 'NEVER', pollingIntervalMs: 5000, rowFormat: 'JSON',
    });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      vendor: 'mysql', host: 'db', port: '3307', database: 'lab', username: 'u', password: 'p', tls: true,
      selectQuery: 'SELECT id FROM o', updateQuery: 'UPDATE o SET s = 1 WHERE id = ${id}', updateMode: 'ON_SUCCESS',
      pollingIntervalMs: 100, rowFormat: 'JSON', processBatch: true,
    };
    expect(databaseSourcePropertiesSchema.parse(all)).toEqual({ ...all, port: 3307 });
  });

  it('leaves vendor and port unset, so the vendor decides the port', () => {
    const parsed = databaseSourcePropertiesSchema.parse(SOURCE_REQUIRED);
    expect(parsed.vendor).toBeUndefined();
    expect(parsed.port).toBeUndefined();
  });

  it.each([
    ['host', ''],
    ['host', '  '],
    ['database', ''],
    ['selectQuery', ''],
    ['port', 0],
    ['port', 70_000],
    ['updateMode', 'SOMETIMES'],
    ['pollingIntervalMs', 99],
    ['pollingIntervalMs', 2_147_483_648],
    ['rowFormat', 'XML'],
    ['tls', 'true'],
    ['tls', { ca: 'x' }],
  ])('rejects %s = %j', (key, value) => {
    expect(databaseSourcePropertiesSchema.safeParse({ ...SOURCE_REQUIRED, [key]: value }).success).toBe(false);
  });

  it('refuses a vendor it has no driver for, naming it', () => {
    const result = databaseSourcePropertiesSchema.safeParse({ ...SOURCE_REQUIRED, vendor: 'oracle' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe('database "oracle" is not supported (PostgreSQL and MySQL are)');
  });

  it('needs an update query when the update mode runs one', () => {
    for (const updateMode of ['ALWAYS', 'ON_SUCCESS']) {
      const result = databaseSourcePropertiesSchema.safeParse({ ...SOURCE_REQUIRED, updateMode, updateQuery: ' ' });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(['updateQuery']);
    }
    expect(databaseSourcePropertiesSchema.safeParse({ ...SOURCE_REQUIRED, updateMode: 'NEVER', updateQuery: '' }).success).toBe(true);
  });

  it('rejects a key it does not know, naming it', () => {
    const result = databaseSourcePropertiesSchema.safeParse({ ...SOURCE_REQUIRED, pollingInterval: 1000 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('pollingInterval');
  });

  // DATABASE_SOURCE_DEFAULTS from 7793c71 (2026-03) until 73d0a87 (2026-11) added `tls`, with the required fields filled.
  it('deploys a source the editor saved before tls existed', () => {
    const old = { host: 'localhost', port: 5432, database: 'lab', username: '', password: '', selectQuery: 'SELECT 1', updateQuery: '', updateMode: 'NEVER', pollingIntervalMs: 5000, rowFormat: 'JSON' };
    expect(databaseSourcePropertiesSchema.parse(old)).toEqual({ ...old, tls: false });
  });
});

describe('databaseDestinationPropertiesSchema', () => {
  it('needs a host, database and query, and fills the defaults', () => {
    expect(databaseDestinationPropertiesSchema.parse(DESTINATION_REQUIRED)).toEqual({
      ...DESTINATION_REQUIRED, ...CONNECTION_DEFAULTS, useTransaction: false, returnGeneratedKeys: false,
    });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      vendor: 'postgresql', host: 'db', port: 5433, database: 'lab', username: 'u', password: 'p', tls: true,
      query: 'INSERT INTO t (a) VALUES (1) RETURNING id', useTransaction: true, returnGeneratedKeys: true, template: '${message.encodedData}',
    };
    expect(databaseDestinationPropertiesSchema.parse(all)).toEqual(all);
  });

  it.each([
    ['query', ''],
    ['host', ''],
    ['useTransaction', 'yes'],
    ['returnGeneratedKeys', 1],
    ['vendor', 'sqlserver'],
  ])('rejects %s = %j', (key, value) => {
    expect(databaseDestinationPropertiesSchema.safeParse({ ...DESTINATION_REQUIRED, [key]: value }).success).toBe(false);
  });

  it('rejects a key it does not know, naming it', () => {
    const result = databaseDestinationPropertiesSchema.safeParse({ ...DESTINATION_REQUIRED, connectionString: 'jdbc:postgresql://db/lab' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('connectionString');
  });

  // The Mirth importer wrote `url` and `driver` from f1c4614 (2026-03-03) until 9cf36a5 (2026-11-12); nothing read them (#227).
  it('drops the url and driver the Mirth importer once wrote', () => {
    const imported = { ...DESTINATION_REQUIRED, url: 'jdbc:postgresql://db/lab', driver: 'org.postgresql.Driver' };
    expect(databaseDestinationPropertiesSchema.parse(imported)).toEqual(databaseDestinationPropertiesSchema.parse(DESTINATION_REQUIRED));
  });
});

describe('a Database Reader the Mirth importer wrote before 2026-11-12 (#227)', () => {
  const imported = { url: 'jdbc:postgresql://db/orders', driver: 'org.postgresql.Driver', query: 'SELECT id FROM o', host: 'db', database: 'orders' };

  it('reads the old query as the select query when the user left that empty, and drops url and driver', () => {
    const parsed = databaseSourcePropertiesSchema.parse({ ...imported, selectQuery: '' });
    expect(parsed.selectQuery).toBe('SELECT id FROM o');
    expect(parsed).not.toHaveProperty('url');
    expect(parsed).not.toHaveProperty('driver');
    expect(parsed).not.toHaveProperty('query');
    expect(databaseSourcePropertiesSchema.parse(imported).selectQuery).toBe('SELECT id FROM o');
  });

  it('keeps a select query the user filled in, dropping the old query', () => {
    const parsed = databaseSourcePropertiesSchema.parse({ ...imported, selectQuery: 'SELECT * FROM o WHERE sent = false' });
    expect(parsed.selectQuery).toBe('SELECT * FROM o WHERE sent = false');
    expect(parsed).not.toHaveProperty('query');
  });

  // DATABASE_DEST_DEFAULTS from 7793c71 (2026-03) until 73d0a87 (2026-11) added `tls`, with the required fields filled.
  it('deploys a destination the editor saved before tls existed', () => {
    const old = { host: 'localhost', port: 5432, database: 'lab', username: '', password: '', query: 'INSERT INTO t VALUES (1)', useTransaction: false, returnGeneratedKeys: false };
    expect(databaseDestinationPropertiesSchema.parse(old)).toEqual({ ...old, tls: false });
  });
});

describe('defaultDatabasePort', () => {
  it('is 5432 for PostgreSQL (and no vendor, or one with no driver) and 3306 for MySQL', () => {
    expect(defaultDatabasePort(undefined)).toBe(5432);
    expect(defaultDatabasePort('sqlserver')).toBe(5432);
    expect(defaultDatabasePort('postgresql')).toBe(5432);
    expect(defaultDatabasePort('mysql')).toBe(3306);
  });
});
