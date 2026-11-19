import { describe, it, expect } from 'vitest';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

const CONNECTION = { host: 'localhost', port: 5432, database: 'lab', username: '', password: '' };

describe('registry DATABASE factories', () => {
  it('build from the properties the editor saves, a text port included', () => {
    expect(() => createSourceConnector('DATABASE', {
      ...CONNECTION, port: '5432', tls: false, selectQuery: 'SELECT 1', updateQuery: '', updateMode: 'NEVER', pollingIntervalMs: 5000, rowFormat: 'JSON',
    })).not.toThrow();
    expect(() => createDestinationConnector('DATABASE', {
      ...CONNECTION, vendor: 'mysql', tls: true, query: 'INSERT INTO t VALUES (1)', useTransaction: false, returnGeneratedKeys: false,
    })).not.toThrow();
  });

  // DATABASE defaults from 7793c71 (2026-03) until 73d0a87 (2026-11) added `tls`, with the required fields filled.
  it('build channels the editor saved before tls existed', () => {
    expect(() => createSourceConnector('DATABASE', {
      ...CONNECTION, selectQuery: 'SELECT 1', updateQuery: '', updateMode: 'NEVER', pollingIntervalMs: 5000, rowFormat: 'JSON',
    })).not.toThrow();
    expect(() => createDestinationConnector('DATABASE', {
      ...CONNECTION, query: 'INSERT INTO t VALUES (1)', useTransaction: false, returnGeneratedKeys: false,
    })).not.toThrow();
  });

  it('build an imported connector with no port and the batch and template keys', () => {
    expect(() => createSourceConnector('DATABASE', { vendor: 'mysql', host: 'db', database: 'lab', selectQuery: 'SELECT 1', processBatch: true })).not.toThrow();
    expect(() => createDestinationConnector('DATABASE', { host: 'db', database: 'lab', query: 'SELECT 1', template: 'x' })).not.toThrow();
  });

  it('refuse a misspelled key instead of ignoring it', () => {
    expect(() => createSourceConnector('DATABASE', { host: 'db', database: 'lab', selectQuery: 'SELECT 1', pollingInterval: 1000 }))
      .toThrow(/DATABASE properties are invalid: .*pollingInterval/);
    expect(() => createDestinationConnector('DATABASE', { host: 'db', database: 'lab', query: 'SELECT 1', connectionString: 'jdbc:postgresql://db/lab' }))
      .toThrow(/connectionString/);
  });

  it('refuse a database with no driver, naming it', () => {
    expect(() => createDestinationConnector('DATABASE', { vendor: 'sqlserver', host: 'db', database: 'lab', query: 'SELECT 1' }))
      .toThrow(/database "sqlserver" is not supported/);
  });

  it('refuse a TLS setting that is not a switch, rather than connecting in plaintext', () => {
    expect(() => createSourceConnector('DATABASE', { host: 'db', database: 'lab', selectQuery: 'SELECT 1', tls: 'true' })).toThrow(/tls/);
  });
});
