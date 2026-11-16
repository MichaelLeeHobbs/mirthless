import { describe, it, expect } from 'vitest';
import { num, readStringRecord, readBasicAuth, readFraming, databaseTarget } from '../registry.js';

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

describe('registry num() coercion', () => {
  it('returns a numeric value as-is', () => {
    expect(num({ port: 6661 }, 'port', 0)).toBe(6661);
  });

  it('coerces a numeric string (e.g. from a JSON/UI config) to a number', () => {
    expect(num({ port: '6661' }, 'port', 0)).toBe(6661);
    expect(typeof num({ port: '6661' }, 'port', 0)).toBe('number');
  });

  it('falls back for missing, empty, null, or non-numeric values', () => {
    expect(num({}, 'port', 22)).toBe(22);
    expect(num({ port: '' }, 'port', 22)).toBe(22);
    expect(num({ port: null }, 'port', 22)).toBe(22);
    expect(num({ port: 'abc' }, 'port', 22)).toBe(22);
    expect(num({ port: undefined }, 'port', 22)).toBe(22);
  });

  // Each row: the stored value and what num() reads with fallback 99.
  const rows: ReadonlyArray<readonly [string, unknown, number]> = [
    ['number 5432', 5432, 5432],
    ['decimal string', '5432', 5432],
    ['padded decimal string', ' 30000 ', 30000],
    // Decimal text a ${PORT} configuration reference can resolve to: a port must not
    // silently become 0 (an ephemeral port) because of a sign or a stray dot.
    ['explicit plus sign', '+6661', 6661],
    ['trailing dot', '6661.', 6661],
    ['leading dot', '.5', 0.5],
    ['exponent string', '1e3', 99],
    ['blank string', ' ', 99],
    ['empty string', '', 99],
    ['boolean true', true, 99],
    ['hex string', '0x10', 99],
    ['NaN', Number.NaN, 99],
    ['Infinity', Number.POSITIVE_INFINITY, 99],
    ['number -1', -1, -1],
    ['undefined', undefined, 99],
    ['null', null, 99],
  ];
  it.each(rows)('reads %s as the expected number', (_label, value, expected) => {
    expect(num({ v: value }, 'v', 99)).toBe(expected);
  });
});
