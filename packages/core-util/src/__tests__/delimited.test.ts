import { describe, it, expect } from 'vitest';
import { delimitedOptionsSchema } from '@galvaniflow/core-models';
import { parseDelimited, serializeDelimited } from '../delimited.js';

const csv = delimitedOptionsSchema.parse({ columnNames: ['mrn', 'family', 'given'] });

describe('parseDelimited', () => {
  it('names columns from the settings, then column<n> past the list', () => {
    expect(parseDelimited('MRN19,DOE,JOHN,X\n', csv)).toEqual([{ mrn: 'MRN19', family: 'DOE', given: 'JOHN', column4: 'X' }]);
  });

  it('names every column column<n> when no names are set', () => {
    expect(parseDelimited('a,b', delimitedOptionsSchema.parse({}))).toEqual([{ column1: 'a', column2: 'b' }]);
  });

  it('keeps every value as text, leading zeros included', () => {
    expect(parseDelimited('000123,02134,1.0', csv)).toEqual([{ mrn: '000123', family: '02134', given: '1.0' }]);
  });

  it('reads several records, skips blank lines, and treats CRLF like LF', () => {
    expect(parseDelimited('1,A,B\r\n\r\n2,C,D\r\n', csv)).toEqual([
      { mrn: '1', family: 'A', given: 'B' },
      { mrn: '2', family: 'C', given: 'D' },
    ]);
  });

  it('keeps empty values, including a trailing one', () => {
    expect(parseDelimited('1,,\n', csv)).toEqual([{ mrn: '1', family: '', given: '' }]);
  });

  it('reads quoted values holding delimiters, newlines and doubled quotes', () => {
    expect(parseDelimited('1,"DOE, JR","say ""hi""\nthere"\n', csv)).toEqual([
      { mrn: '1', family: 'DOE, JR', given: 'say "hi"\nthere' },
    ]);
  });

  it('reads an empty quoted value and one that is a single quote', () => {
    expect(parseDelimited('"",""""', csv)).toEqual([{ mrn: '', family: '"' }]);
  });

  it('reads backslash-escaped quotes when doubling is off', () => {
    const o = delimitedOptionsSchema.parse({ escapeWithDoubleQuote: false });
    expect(parseDelimited('"a\\"b",c', o)).toEqual([{ column1: 'a"b', column2: 'c' }]);
  });

  it('treats quotes as text when quoting is off', () => {
    const o = delimitedOptionsSchema.parse({ quote: '' });
    expect(parseDelimited('"a",b', o)).toEqual([{ column1: '"a"', column2: 'b' }]);
  });

  it('uses multi-character and pipe delimiters', () => {
    const o = delimitedOptionsSchema.parse({ columnDelimiter: '|', recordDelimiter: '~~' });
    expect(parseDelimited('a|b~~c|d~~', o)).toEqual([{ column1: 'a', column2: 'b' }, { column1: 'c', column2: 'd' }]);
  });

  it('keeps CR when CR is the record delimiter', () => {
    const o = delimitedOptionsSchema.parse({ recordDelimiter: '\r' });
    expect(parseDelimited('a\rb', o)).toEqual([{ column1: 'a' }, { column1: 'b' }]);
  });

  it('throws on a quoted value that never closes', () => {
    expect(() => parseDelimited('1,"DOE\n2,X', csv)).toThrow(/never closes/);
  });

  it('returns no rows for empty text', () => {
    expect(parseDelimited('', csv)).toEqual([]);
  });
});

describe('serializeDelimited', () => {
  it('round-trips what it parses', () => {
    const text = '1,"DOE, JR","say ""hi"""\n2,SMITH,ANN\n';
    expect(serializeDelimited(parseDelimited(text, csv), csv)).toBe(text);
  });

  it('writes a single row object, and columns a script added after the others', () => {
    const row = parseDelimited('1,DOE,JOHN', csv)[0]!;
    row['status'] = 'NEW';
    expect(serializeDelimited(row, csv)).toBe('1,DOE,JOHN,NEW\n');
  });

  it('writes null and undefined as empty and other values as text', () => {
    expect(serializeDelimited([{ a: null, b: undefined, c: 5 }], csv)).toBe(',,5\n');
  });

  it('escapes with the quote escape when doubling is off, and never quotes when quoting is off', () => {
    expect(serializeDelimited([{ a: 'x"y' }], delimitedOptionsSchema.parse({ escapeWithDoubleQuote: false }))).toBe('"x\\"y"\n');
    expect(serializeDelimited([{ a: 'x,y' }], delimitedOptionsSchema.parse({ quote: '' }))).toBe('x,y\n');
  });
});
