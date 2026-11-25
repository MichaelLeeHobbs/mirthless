import { describe, it, expect } from 'vitest';
import { delimitedOptionsSchema } from '@galvanigraph/core-models';
import { parseDelimited, serializeDelimited, unescapeControlChars } from '../delimited.js';

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

  it('reads a doubled quote escape as one when doubling is off, and keeps a lone one', () => {
    const o = delimitedOptionsSchema.parse({ escapeWithDoubleQuote: false });
    expect(parseDelimited('"C:\\\\dir\\\\",x\\y', o)).toEqual([{ column1: 'C:\\dir\\', column2: 'x\\y' }]);
    expect(parseDelimited('"a\\b"', o)).toEqual([{ column1: 'a\\b' }]);
  });

  // Regression: per-field scans of the rest of the text made a 338 KB file take
  // 11 s. A linear parse takes well under a second.
  it.each([
    ['quoted', '"v","w"\n', 60_000],
    ['single-column', 'value\n', 200_000],
    ['single-column quoted', '"value"\n', 200_000],
  ])('parses a large %s file in linear time', (_name, line, count) => {
    const text = line.repeat(count);
    const started = performance.now();
    const rows = parseDelimited(text, delimitedOptionsSchema.parse({}));
    const elapsed = performance.now() - started;
    expect(rows).toHaveLength(count);
    expect(elapsed).toBeLessThan(2_000);
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

  // JavaScript lists keys that are whole numbers first, and assigning to __proto__ adds no key (#372).
  it.each([
    ['whole numbers, against their order', ['2', '1'], '1,2,3'],
    ['a whole number between other names', ['mrn', '2', 'name'], 'A,B,C,D'],
    ['a whole number that is another column\'s place', ['10', '2', '0'], 'A,B,C,D,E'],
    ['__proto__', ['__proto__', 'mrn'], 'A,B'],
    ['__proto__ alone', ['__proto__'], 'A,B'],
    ['names every object has', ['constructor', 'toString', 'hasOwnProperty'], 'A,B,C'],
  ])('reads and writes columns named %s in the order of the record', (_what, columnNames, text) => {
    const o = delimitedOptionsSchema.parse({ columnNames });
    const rows = parseDelimited(text, o);
    expect(Object.keys(rows[0]!)).toHaveLength(text.split(',').length);
    expect(serializeDelimited(rows, o)).toBe(`${text}\n`);
    // As a script's rows come back.
    expect(serializeDelimited(JSON.parse(JSON.stringify(rows)), o)).toBe(`${text}\n`);
  });

  it('keeps the columns\' places when a script edits one, deletes one or adds one', () => {
    const o = delimitedOptionsSchema.parse({ columnNames: ['2', '1', 'name'] });
    const read = (): Record<string, string> => parseDelimited('A,B,C,D', o)[0]!;
    expect(serializeDelimited({ ...read(), 1: 'X' }, o)).toBe('A,X,C,D\n');
    const { name: _name, ...without } = read();
    expect(serializeDelimited(without, o)).toBe('A,B,D\n');
    expect(serializeDelimited({ ...read(), status: 'NEW', 7: 'LAST' }, o)).toBe('A,B,C,D,LAST,NEW\n');
    expect(serializeDelimited({ ...read(), column1: 'ADDED' }, o)).toBe('A,B,C,D,ADDED\n');
  });

  it('writes a row a script built in its key order', () => {
    expect(serializeDelimited([{ given: 'JOHN', mrn: '1', family: 'DOE' }], csv)).toBe('JOHN,1,DOE\n');
    expect(serializeDelimited([['x', 'y']], csv)).toBe('x,y\n');
  });

  it('writes null and undefined as empty and other values as text', () => {
    expect(serializeDelimited([{ a: null, b: undefined, c: 5 }], csv)).toBe(',,5\n');
  });

  it('escapes quotes and the quote escape itself when doubling is off', () => {
    const o = delimitedOptionsSchema.parse({ escapeWithDoubleQuote: false });
    expect(serializeDelimited([{ a: 'x"y' }], o)).toBe('"x\\"y"\n');
    expect(serializeDelimited([{ a: 'say "hi\\' }], o)).toBe('"say \\"hi\\\\"\n');
  });

  const SETTINGS = [
    {},
    { escapeWithDoubleQuote: false },
    { columnDelimiter: '|', recordDelimiter: '~~', quote: "'" },
    { columnDelimiter: '\t', recordDelimiter: '\r\n', ignoreCR: false },
  ];
  const VALUES = ['plain', '', 'Smith, John', 'say "hi"', 'say "hi\\', 'C:\\dir\\', 'two\nlines', 'a|b~~c', "it's", '\t\r\n', '"', '\\'];

  it.each(SETTINGS)('reads back exactly what it writes with settings %j', (settings) => {
    const o = delimitedOptionsSchema.parse(settings);
    const rows = VALUES.map((value, i) => ({ column1: String(i), column2: value, column3: 'end' }));
    const parsed = parseDelimited(serializeDelimited(rows, o), { ...o, ignoreCR: false });
    expect(parsed).toEqual(rows);
  });
});

describe('unescapeControlChars', () => {
  it('turns typed \\n, \\r and \\t into LF, CR and tab', () => {
    expect(unescapeControlChars('\\r\\n')).toBe('\r\n');
    expect(unescapeControlChars('a\\tb')).toBe('a\tb');
  });

  it('turns a doubled backslash into one backslash', () => {
    expect(unescapeControlChars('a\\\\b')).toBe('a\\b');
  });

  it('reads \\\\n as a backslash followed by n, not a newline', () => {
    expect(unescapeControlChars('\\\\n')).toBe('\\n');
  });

  it('leaves any other backslash and plain text unchanged', () => {
    expect(unescapeControlChars('\\x|,')).toBe('\\x|,');
    expect(unescapeControlChars('')).toBe('');
    expect(unescapeControlChars('trailing\\')).toBe('trailing\\');
  });
});
