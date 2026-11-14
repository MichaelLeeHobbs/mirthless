import { describe, it, expect } from 'vitest';
import { escapeCsvField } from '../csv.js';

describe('escapeCsvField', () => {
  it('leaves a plain field alone', () => {
    expect(escapeCsvField('ADT^A01')).toBe('ADT^A01');
    expect(escapeCsvField('')).toBe('');
  });

  it('quotes a field holding a comma, quote or line break and doubles quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('a\rb')).toBe('"a\rb"');
  });

  it('prefixes a quote to a field a spreadsheet would run as a formula', () => {
    for (const lead of ['=', '+', '-', '@', '\t']) {
      expect(escapeCsvField(`${lead}SUM(A1)`)).toBe(`'${lead}SUM(A1)`);
    }
  });

  it('guards and quotes a formula that also needs quoting', () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(escapeCsvField('\rcmd')).toBe('"\'\rcmd"');
  });
});
