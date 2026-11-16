import { describe, it, expect } from 'vitest';
import { readStringRecord, readBasicAuth, readFraming, databaseTarget } from '../registry.js';

describe('registry databaseTarget()', () => {
  it('is PostgreSQL on 5432 by default, MySQL on 3306, and keeps a port that is set', () => {
    expect(databaseTarget({})).toEqual({ vendor: 'postgresql', port: 5432 });
    expect(databaseTarget({ vendor: 'mysql' })).toEqual({ vendor: 'mysql', port: 3306 });
    expect(databaseTarget({ vendor: 'mysql', port: 3307 })).toEqual({ vendor: 'mysql', port: 3307 });
  });
});

describe('registry readFraming()', () => {
  it('is MLLP (undefined) unless frame bytes are set, and parses the ones that are', () => {
    expect(readFraming({})).toBeUndefined();
    expect(readFraming({ frameStart: '02', frameEnd: '03' })).toEqual({ start: Buffer.from([2]), end: Buffer.from([3]) });
    expect(() => readFraming({ frameEnd: 'nope' })).toThrow();
  });
});

describe('registry readStringRecord() and readBasicAuth()', () => {
  it('keeps only string values and rejects what is not a map', () => {
    expect(readStringRecord({ a: 'x', b: 2, c: null })).toEqual({ a: 'x' });
    expect(readStringRecord(['a'])).toBeUndefined();
    expect(readStringRecord(undefined)).toBeUndefined();
  });

  it('reads Basic credentials only with a username and a string password', () => {
    expect(readBasicAuth({ username: 'u', password: '' })).toEqual({ username: 'u', password: '' });
    expect(readBasicAuth({ username: '', password: 'p' })).toBeUndefined();
    expect(readBasicAuth({ username: 'u' })).toBeUndefined();
  });
});

