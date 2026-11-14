// ===========================================
// Delimited Text
// ===========================================
// CSV and other delimited text as rows of named columns. Every value is text:
// "000123" is an MRN, and turning it into 123 corrupts the message.

import type { DelimitedOptions } from '@galvaniflow/core-models';

/** One record: column name to value. */
export type DelimitedRow = Record<string, string>;

interface Field {
  readonly value: string;
  /** Index of the delimiter after the value, or the text length at the end. */
  readonly next: number;
}

/** Index of the first of `tokens` at or after `from`, or the text length when none occurs. */
function nearest(text: string, from: number, tokens: readonly string[]): number {
  let best = text.length;
  for (const token of tokens) {
    const at = text.indexOf(token, from);
    if (at !== -1 && at < best) best = at;
  }
  return best;
}

function readQuoted(text: string, start: number, o: DelimitedOptions): Field {
  const escaped = o.escapeWithDoubleQuote ? o.quote + o.quote : o.quoteEscape + o.quote;
  let value = '';
  let i = start + o.quote.length;
  let closed = false;
  while (!closed) {
    const close = text.indexOf(o.quote, i);
    if (close === -1) throw new Error(`Delimited text has a quoted value that never closes (starts at character ${String(start)})`);
    const escape = text.indexOf(escaped, i);
    if (escape !== -1 && escape <= close) {
      value += text.slice(i, escape) + o.quote;
      i = escape + escaped.length;
    } else {
      value += text.slice(i, close);
      i = close + o.quote.length;
      closed = true;
    }
  }
  // Text between the closing quote and the next delimiter is kept, not dropped.
  const next = nearest(text, i, [o.columnDelimiter, o.recordDelimiter]);
  return { value: value + text.slice(i, next), next };
}

function readField(text: string, start: number, o: DelimitedOptions): Field {
  if (o.quote !== '' && text.startsWith(o.quote, start)) return readQuoted(text, start, o);
  const next = nearest(text, start, [o.columnDelimiter, o.recordDelimiter]);
  return { value: text.slice(start, next), next };
}

function splitRecords(text: string, o: DelimitedOptions): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let i = 0;
  while (i <= text.length) {
    const field = readField(text, i, o);
    fields.push(field.value);
    if (field.next >= text.length) {
      records.push(fields);
      break;
    }
    if (text.startsWith(o.columnDelimiter, field.next)) {
      i = field.next + o.columnDelimiter.length;
      continue;
    }
    records.push(fields);
    fields = [];
    i = field.next + o.recordDelimiter.length;
    if (i >= text.length) break; // a final record delimiter does not start an empty record
  }
  return records;
}

function stripCarriageReturns(text: string, o: DelimitedOptions): string {
  if (!o.ignoreCR || o.recordDelimiter.includes('\r') || o.columnDelimiter.includes('\r')) return text;
  return text.replaceAll('\r', '');
}

/**
 * Parse delimited text into rows keyed by the configured column names, then
 * `column<n>` (1-based) for columns past the list. Blank lines are skipped.
 * Throws when a quoted value never closes.
 */
export function parseDelimited(text: string, options: DelimitedOptions): DelimitedRow[] {
  const records = splitRecords(stripCarriageReturns(text, options), options);
  const rows: DelimitedRow[] = [];
  for (const fields of records) {
    if (fields.length === 1 && fields[0] === '') continue;
    const row: DelimitedRow = {};
    fields.forEach((value, index) => { row[options.columnNames[index] ?? `column${String(index + 1)}`] = value; });
    rows.push(row);
  }
  return rows;
}

function writeValue(raw: unknown, o: DelimitedOptions): string {
  const value = raw === null || raw === undefined ? '' : String(raw);
  if (o.quote === '') return value;
  const needsQuotes = [o.columnDelimiter, o.recordDelimiter, o.quote, '\r', '\n'].some((token) => value.includes(token));
  if (!needsQuotes) return value;
  const escaped = o.escapeWithDoubleQuote ? o.quote + o.quote : o.quoteEscape + o.quote;
  return o.quote + value.replaceAll(o.quote, escaped) + o.quote;
}

/**
 * Write rows (or a single row) as delimited text, columns in each row's key
 * order, every record followed by the record delimiter. Values that hold a
 * delimiter or a quote are quoted.
 */
export function serializeDelimited(rows: unknown, options: DelimitedOptions): string {
  const list: readonly unknown[] = Array.isArray(rows) ? rows : [rows];
  let out = '';
  for (const row of list) {
    const values = row !== null && typeof row === 'object' ? Object.values(row) : [row];
    out += values.map((v) => writeValue(v, options)).join(options.columnDelimiter) + options.recordDelimiter;
  }
  return out;
}
