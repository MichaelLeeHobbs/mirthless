// database-postgres.itest.ts reads the same from a real PostgreSQL.

import { describe, it, expect } from 'vitest';
import { POSTGRES_TYPES } from '../postgres-values.js';

const OID = {
  BOOL: 16, INT8: 20, INT4: 23, JSON: 114, JSONB: 3802, FLOAT8: 701, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184, INTERVAL: 1186,
  JSON_ARRAY: 199, FLOAT8_ARRAY: 1022, TIMESTAMP_ARRAY: 1115, DATE_ARRAY: 1182, TIMESTAMPTZ_ARRAY: 1185, INTERVAL_ARRAY: 1187, NUMERIC_ARRAY: 1231,
} as const;

function read(type: keyof typeof OID, text: string): unknown {
  return (POSTGRES_TYPES.getTypeParser as (oid: number, format: string) => (value: string) => unknown)(OID[type], 'text')(text);
}

/** The value as it stands in the message. */
function sent(type: keyof typeof OID, text: string): unknown {
  return JSON.parse(JSON.stringify(read(type, text)));
}

describe('PostgreSQL values', () => {
  it.each([
    ['DATE', '2026-01-15', '2026-01-15'],
    ['DATE', 'infinity', 'infinity'],
    ['DATE', '0044-03-15 BC', '0044-03-15 BC'],
    ['DATE', '15/01/2026', '15/01/2026'],
    ['TIMESTAMP', '2026-01-15 00:30:00', '2026-01-15T00:30:00.000'],
    ['TIMESTAMP', '2026-01-15 00:30:00.5', '2026-01-15T00:30:00.500'],
    ['TIMESTAMP', '2026-01-15 00:30:00.123456', '2026-01-15T00:30:00.123456'],
    ['TIMESTAMP', '-infinity', '-infinity'],
    ['TIMESTAMP', '12026-01-15 00:30:00', '12026-01-15 00:30:00'],
    ['TIMESTAMPTZ', '2026-01-15 00:30:00+00', '2026-01-15T00:30:00.000Z'],
    ['TIMESTAMPTZ', '2026-01-15 00:30:00.123456-08', '2026-01-15T08:30:00.123456Z'],
    ['TIMESTAMPTZ', '2026-01-15 00:30:00.1+05:30', '2026-01-14T19:00:00.100Z'],
    ['TIMESTAMPTZ', '1880-01-15 00:30:00-07:52:58', '1880-01-15T08:22:58.000Z'],
    ['TIMESTAMPTZ', '0050-01-15 00:30:00+00', '0050-01-15T00:30:00.000Z'],
    ['TIMESTAMPTZ', '9999-12-31 23:30:00-08', '9999-12-31 23:30:00-08'],
    ['TIMESTAMPTZ', 'infinity', 'infinity'],
    ['FLOAT8', '1.5', 1.5],
    ['FLOAT8', '1e+300', 1e300],
    ['FLOAT8', 'NaN', 'NaN'],
    ['FLOAT8', '-Infinity', '-Infinity'],
    ['INTERVAL', '1 day 02:03:04.5', { days: 1, hours: 2, minutes: 3, seconds: 4, milliseconds: 500 }],
    ['INTERVAL', '-1 years -2 mons +3 days -04:00:00', { years: -1, months: -2, days: 3, hours: -4 }],
    ['INTERVAL', '00:00:00', {}],
    ['INTERVAL', 'infinity', 'infinity'],
    ['INTERVAL', 'P1DT2H', 'P1DT2H'],
    ['BOOL', 't', true],
    ['INT4', '7', 7],
    ['INT8', '9007199254740993', '9007199254740993'],
  ] as const)('%s %s', (type, text, value) => {
    expect(sent(type, text)).toEqual(value);
  });

  it.each([
    ['DATE_ARRAY', '{2026-01-15,NULL}', ['2026-01-15', null]],
    ['TIMESTAMP_ARRAY', '{{"2026-01-15 00:30:00"},{"2026-01-15 00:30:00.123456"}}', [['2026-01-15T00:30:00.000'], ['2026-01-15T00:30:00.123456']]],
    ['TIMESTAMPTZ_ARRAY', '{"2026-01-15 00:30:00+09"}', ['2026-01-14T15:30:00.000Z']],
    ['NUMERIC_ARRAY', '{1.10,12345678901234567890.1,NaN}', ['1.10', '12345678901234567890.1', 'NaN']],
    ['FLOAT8_ARRAY', '{1.5,NaN}', [1.5, 'NaN']],
    ['INTERVAL_ARRAY', '{"1 day",infinity}', [{ days: 1 }, 'infinity']],
    ['JSON_ARRAY', '{"{\\"n\\":12345678901234567890,\\"s\\":\\"x\\"}","null"}', [{ n: '12345678901234567890', s: 'x' }, null]],
    ['DATE_ARRAY', '{}', []],
  ] as const)('%s %s', (type, text, value) => {
    expect(sent(type, text)).toEqual(value);
  });

  it.each([
    ['12345678901234567890', '12345678901234567890'],
    ['9007199254740993', '9007199254740993'],
    ['0.12345678901234567891', '0.12345678901234567891'],
    ['123456789.123456789', '123456789.123456789'],
    ['1e400', '1e400'],
    ['1e-400', '1e-400'],
    ['-12345678901234567890', '-12345678901234567890'],
    ['123456789012345678901234567890e-29', '123456789012345678901234567890e-29'],
  ])('a JSON number that a double cannot hold is text: %s', (json, value) => {
    expect(read('JSON', `{"n":${json}}`)).toEqual({ n: value });
    expect(read('JSONB', json)).toBe(value);
  });

  it.each([
    ['1.10', 1.1], ['1e3', 1000], ['9007199254740992', 9007199254740992], ['10000000000000000000000', 1e22],
    ['-0', -0], ['0.0000000000000000000', 0], ['0.30000000000000004', 0.30000000000000004],
  ])('a JSON number that a double holds stays a number: %s', (json, value) => {
    expect(read('JSON', `[${json}]`)).toEqual([value]);
  });

  it('keeps text, keys and nesting in JSON as they are', () => {
    const text = '{"12345678901234567890":["12345678901234567890",{"e1E2":null,"t":true}]}';
    expect(read('JSON', text)).toEqual(JSON.parse(text));
  });
});
