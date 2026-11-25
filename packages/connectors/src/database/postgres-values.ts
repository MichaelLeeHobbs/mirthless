// What a PostgreSQL value is in a row (D-358). A row becomes JSON, so a value pg would turn into
// a Date (shifted into UTC, cut to milliseconds) or into a number that cannot hold it is text here.

import pg from 'pg';

type ParseText = (text: string) => unknown;

const OID = {
  JSON: 114,
  JSON_ARRAY: 199,
  FLOAT4: 700,
  FLOAT8: 701,
  FLOAT4_ARRAY: 1021,
  FLOAT8_ARRAY: 1022,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMP_ARRAY: 1115,
  DATE_ARRAY: 1182,
  TIMESTAMPTZ: 1184,
  TIMESTAMPTZ_ARRAY: 1185,
  INTERVAL: 1186,
  INTERVAL_ARRAY: 1187,
  NUMERIC_ARRAY: 1231,
  JSONB: 3802,
  JSONB_ARRAY: 3807,
} as const;
/** Not in pg's list of type ids. */
const TEXT_ARRAY_OID: number = 1009;

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/;
const TIMESTAMPTZ = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-])(\d{2})(?::(\d{2}))?(?::(\d{2}))?$/;
const ISO_LENGTH = '2026-01-15T00:30:00.000Z'.length;
/** `IntervalStyle` postgres, the one pg reads. */
const INTERVAL = /^(?:[+-]?\d+ years? ?)?(?:[+-]?\d+ mons? ?)?(?:[+-]?\d+ days? ?)?(?:[+-]?\d+:\d{2}:\d{2}(?:\.\d{1,6})?)?$/;
/** Below 16 digits and without an exponent, a JSON number is exact as a double. */
const MAY_BE_INEXACT = /[\d.]{16}|\d[eE]/;
const DECIMAL = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** At least milliseconds, as a Date's ISO text has. */
function fraction(digits: string | undefined): string {
  return (digits ?? '').padEnd(3, '0');
}

function asIs(text: string): string {
  return text;
}

function parseTimestamp(text: string): string {
  const match = TIMESTAMP.exec(text);
  return match === null ? text : `${match[1]}T${match[2]}.${fraction(match[3])}`;
}

/** The instant in UTC, as the Date this replaces was written, with its microseconds. */
function parseTimestamptz(text: string): string {
  const match = TIMESTAMPTZ.exec(text);
  if (match === null) return text;
  const [, date, time, digits, sign, hours, minutes, seconds] = match;
  const offsetMs = (Number(hours) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1_000;
  const utc = new Date(Date.parse(`${date}T${time}Z`) - (sign === '-' ? -offsetMs : offsetMs)).toISOString();
  return utc.length === ISO_LENGTH ? `${utc.slice(0, -'000Z'.length)}${fraction(digits)}Z` : text;
}

/** JSON has no NaN and no Infinity: both would be null. */
function parseFloatValue(text: string): number | string {
  const value = Number(text);
  return Number.isFinite(value) ? value : text;
}

/** The style a server may be set to, and 'infinity', are read by pg as no interval at all. */
function parseInterval(text: string): unknown {
  return INTERVAL.test(text) ? pg.types.getTypeParser(OID.INTERVAL)(text) : text;
}

/** Equal for two ways to write one number; null for text that is none. */
function canonical(decimal: string): string | null {
  const match = DECIMAL.exec(decimal);
  if (match === null) return null;
  const places = match[2] ?? '';
  const digits = `${match[1]}${places}`;
  let end = digits.length;
  while (end > 0 && digits[end - 1] === '0') end -= 1;
  const significant = digits.slice(0, end).replace(/^0+/, '');
  if (significant === '') return '0';
  return `${decimal.startsWith('-') ? '-' : ''}${significant}e${String(Number(match[3] ?? 0) - places.length + digits.length - end)}`;
}

/** The reviver's third argument (JSON.parse source text access) is not in the ES2022 library. */
const parseJsonWithSource = JSON.parse as (
  text: string,
  reviver: (key: string, value: unknown, context: { readonly source?: string }) => unknown,
) => unknown;

/** A number a double cannot hold is its digits as text, as mysql2 gives an integer in a JSON column. */
function parseJson(text: string): unknown {
  if (!MAY_BE_INEXACT.test(text)) return JSON.parse(text);
  return parseJsonWithSource(text, (_key, value, { source }) =>
    typeof value === 'number' && source !== undefined && canonical(source) !== canonical(String(value)) ? source : value);
}

/** Each element of an array of any depth. */
function arrayOf(parseElement: ParseText): ParseText {
  return (text) => {
    const elements: unknown = pg.types.getTypeParser(TEXT_ARRAY_OID)(text);
    return JSON.parse(JSON.stringify(elements), (_key, value: unknown) => (typeof value === 'string' ? parseElement(value) : value));
  };
}

const PARSERS: ReadonlyMap<number, ParseText> = new Map<number, ParseText>([
  [OID.DATE, asIs],
  [OID.DATE_ARRAY, arrayOf(asIs)],
  [OID.TIMESTAMP, parseTimestamp],
  [OID.TIMESTAMP_ARRAY, arrayOf(parseTimestamp)],
  [OID.TIMESTAMPTZ, parseTimestamptz],
  [OID.TIMESTAMPTZ_ARRAY, arrayOf(parseTimestamptz)],
  [OID.INTERVAL, parseInterval],
  [OID.INTERVAL_ARRAY, arrayOf(parseInterval)],
  [OID.FLOAT4, parseFloatValue],
  [OID.FLOAT8, parseFloatValue],
  [OID.FLOAT4_ARRAY, arrayOf(parseFloatValue)],
  [OID.FLOAT8_ARRAY, arrayOf(parseFloatValue)],
  [OID.NUMERIC_ARRAY, arrayOf(asIs)],
  [OID.JSON, parseJson],
  [OID.JSONB, parseJson],
  [OID.JSON_ARRAY, arrayOf(parseJson)],
  [OID.JSONB_ARRAY, arrayOf(parseJson)],
]);

/** pg's own parser for every type not listed. pg calls it with the text format only, and never for NULL. */
export const POSTGRES_TYPES: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number) => PARSERS.get(oid) ?? pg.types.getTypeParser(oid)) as pg.CustomTypesConfig['getTypeParser'],
};
