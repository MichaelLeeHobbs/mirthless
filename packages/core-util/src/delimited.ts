// Every value stays text: "000123" is an MRN, and 123 corrupts the message.

import type { DelimitedOptions } from '@galvanigraph/core-models';

export type DelimitedRow = Record<string, string>;

interface Field {
  readonly value: string;
  /** Index of the delimiter after the value, or the text length at the end. */
  readonly next: number;
}

// Every scan stops at its own field's end. Searching the whole rest of the
// text for each field (indexOf) made a large file quadratic.

function nextDelimiter(text: string, from: number, o: DelimitedOptions): number {
  let i = from;
  while (i < text.length && !text.startsWith(o.columnDelimiter, i) && !text.startsWith(o.recordDelimiter, i)) i += 1;
  return i;
}

function readQuoted(text: string, start: number, o: DelimitedOptions): Field {
  const escapedQuote = o.escapeWithDoubleQuote ? o.quote + o.quote : o.quoteEscape + o.quote;
  const escapedEscape = o.escapeWithDoubleQuote ? undefined : o.quoteEscape + o.quoteEscape;
  const parts: string[] = [];
  let run = start + o.quote.length;
  let i = run;
  while (i < text.length) {
    const literal = text.startsWith(escapedQuote, i) ? escapedQuote
      : escapedEscape !== undefined && text.startsWith(escapedEscape, i) ? escapedEscape : undefined;
    if (literal !== undefined) {
      parts.push(text.slice(run, i), literal === escapedQuote ? o.quote : o.quoteEscape);
      i += literal.length;
      run = i;
    } else if (text.startsWith(o.quote, i)) {
      // Text between the closing quote and the next delimiter is kept, not dropped.
      const after = i + o.quote.length;
      const next = nextDelimiter(text, after, o);
      parts.push(text.slice(run, i), text.slice(after, next));
      return { value: parts.join(''), next };
    } else {
      i += 1;
    }
  }
  throw new Error(`Delimited text has a quoted value that never closes (starts at character ${String(start)})`);
}

function readField(text: string, start: number, o: DelimitedOptions): Field {
  if (text.startsWith(o.quote, start)) return readQuoted(text, start, o);
  const next = nextDelimiter(text, start, o);
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

/** Throws when a quoted value never closes. */
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
  const needsQuotes = [o.columnDelimiter, o.recordDelimiter, o.quote, '\r', '\n'].some((token) => value.includes(token));
  if (!needsQuotes) return value;
  if (o.escapeWithDoubleQuote) return o.quote + value.replaceAll(o.quote, o.quote + o.quote) + o.quote;
  const escaped = value.replaceAll(o.quoteEscape, o.quoteEscape + o.quoteEscape).replaceAll(o.quote, o.quoteEscape + o.quote);
  return o.quote + escaped + o.quote;
}

/** Columns go in each row's key order, not `columnNames` order. */
export function serializeDelimited(rows: unknown, options: DelimitedOptions): string {
  const list: readonly unknown[] = Array.isArray(rows) ? rows : [rows];
  let out = '';
  for (const row of list) {
    const values = row !== null && typeof row === 'object' ? Object.values(row) : [row];
    out += values.map((v) => writeValue(v, options)).join(options.columnDelimiter) + options.recordDelimiter;
  }
  return out;
}

/** Delimited settings are typed this way in the channel editor and in Mirth's exported serializationProperties. */
export function unescapeControlChars(text: string): string {
  return text.replace(/\\([nrt\\])/g, (_m, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? '\\');
}
