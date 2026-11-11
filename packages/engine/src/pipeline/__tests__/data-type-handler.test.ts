// ===========================================
// Data Type Handler Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { parseForSandbox, serializeFromSandbox, serializeTransformed, isHl7MessageProxy, createHl7Proxy } from '../data-type-handler.js';
import { Hl7Message } from '@galvaniflow/core-util';

const SAMPLE_HL7 = [
  'MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20260329||ADT^A01|MSG001|P|2.5',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
].join('\r');

const SAMPLE_JSON = '{"patient":{"name":"John Doe","mrn":"12345"}}';

const SAMPLE_XML = '<patient><name>John Doe</name><mrn>12345</mrn></patient>';

describe('parseForSandbox', () => {
  it('returns string as-is for RAW', () => {
    const result = parseForSandbox('hello world', 'RAW');
    expect(result).toBe('hello world');
  });

  it('parses HL7V2 into Hl7MessageProxy', () => {
    const result = parseForSandbox(SAMPLE_HL7, 'HL7V2');
    expect(isHl7MessageProxy(result)).toBe(true);
  });

  it('HL7V2 proxy supports get(path)', () => {
    const msg = parseForSandbox(SAMPLE_HL7, 'HL7V2');
    expect((msg as { get: (p: string) => string | undefined }).get('PID.3')).toBe('12345');
  });

  it('HL7V2 proxy supports messageType', () => {
    const msg = parseForSandbox(SAMPLE_HL7, 'HL7V2') as { messageType: string };
    // messageType auto-resolves to first component of MSH.9
    expect(msg.messageType).toBe('ADT');
  });

  it('parses JSON into object', () => {
    const result = parseForSandbox(SAMPLE_JSON, 'JSON');
    expect(result).toEqual({ patient: { name: 'John Doe', mrn: '12345' } });
  });

  it('parses XML into object', () => {
    const result = parseForSandbox(SAMPLE_XML, 'XML') as Record<string, unknown>;
    expect(result).toHaveProperty('patient');
    const patient = (result as { patient: { name: string; mrn: string } }).patient;
    expect(patient.name).toBe('John Doe');
    // Values are always text, even when they look like numbers.
    expect(patient.mrn).toBe('12345');
  });

  it('returns string for unsupported types (DELIMITED, HL7V3, FHIR, DICOM)', () => {
    expect(parseForSandbox('data', 'DELIMITED')).toBe('data');
    expect(parseForSandbox('data', 'HL7V3')).toBe('data');
    expect(parseForSandbox('data', 'FHIR')).toBe('data');
    expect(parseForSandbox('data', 'DICOM')).toBe('data');
  });

  it('throws on invalid HL7V2', () => {
    expect(() => parseForSandbox('not valid hl7', 'HL7V2')).toThrow();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseForSandbox('not json {{{', 'JSON')).toThrow();
  });

  it('does not throw on lenient XML (fast-xml-parser is permissive)', () => {
    // fast-xml-parser accepts most input without throwing
    expect(() => parseForSandbox('<<<>>>', 'XML')).not.toThrow();
  });
});

describe('serializeFromSandbox', () => {
  it('passes string through', () => {
    expect(serializeFromSandbox('hello', 'RAW')).toBe('hello');
  });

  it('serializes HL7 proxy via toString()', () => {
    const proxy = createHl7Proxy(Hl7Message.parse(SAMPLE_HL7));
    const result = serializeFromSandbox(proxy, 'HL7V2');
    expect(result).toContain('MSH|');
    expect(result).toContain('PID|');
  });

  it('serializes JS object as JSON', () => {
    const obj = { patient: { name: 'John' } };
    expect(serializeFromSandbox(obj, 'JSON')).toBe('{"patient":{"name":"John"}}');
  });

  it('serializes XML object back to XML', () => {
    const parsed = parseForSandbox(SAMPLE_XML, 'XML');
    const result = serializeFromSandbox(parsed, 'XML');
    expect(result).toContain('<patient>');
    expect(result).toContain('<name>John Doe</name>');
  });

  it('converts null/undefined to empty string', () => {
    expect(serializeFromSandbox(null, 'RAW')).toBe('');
    expect(serializeFromSandbox(undefined, 'RAW')).toBe('');
  });

  it('converts numbers via String()', () => {
    expect(serializeFromSandbox(42, 'RAW')).toBe('42');
  });
});

describe('isHl7MessageProxy', () => {
  it('returns true for proxy created by createHl7Proxy', () => {
    const proxy = createHl7Proxy(Hl7Message.parse(SAMPLE_HL7));
    expect(isHl7MessageProxy(proxy)).toBe(true);
  });

  it('returns false for strings', () => {
    expect(isHl7MessageProxy('hello')).toBe(false);
  });

  it('returns false for plain objects', () => {
    expect(isHl7MessageProxy({ get: () => '' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isHl7MessageProxy(null)).toBe(false);
    expect(isHl7MessageProxy(undefined)).toBe(false);
  });
});

describe('roundtrip: parse → serialize → parse', () => {
  it('HL7V2 roundtrip preserves field values', () => {
    const proxy1 = parseForSandbox(SAMPLE_HL7, 'HL7V2') as { get: (p: string) => string | undefined; toString: () => string };
    const serialized = serializeFromSandbox(proxy1, 'HL7V2');
    const proxy2 = parseForSandbox(serialized, 'HL7V2') as { get: (p: string) => string | undefined };
    expect(proxy2.get('PID.3')).toBe('12345');
    // get() auto-resolves to first component — DOE (not DOE^JOHN)
    expect(proxy2.get('PID.5')).toBe('DOE');
  });

  it('JSON roundtrip preserves values', () => {
    const obj = parseForSandbox(SAMPLE_JSON, 'JSON');
    const serialized = serializeFromSandbox(obj, 'JSON');
    const obj2 = parseForSandbox(serialized, 'JSON');
    expect(obj2).toEqual(obj);
  });
});

describe('parseForSandbox — XML entity expansion limits', () => {
  it('still decodes the standard XML entities', () => {
    expect(parseForSandbox('<r>a &amp; b &lt;c&gt;</r>', 'XML')).toEqual({ r: 'a & b <c>' });
  });

  it('rejects a document whose entity references expand past the size cap', () => {
    const big = 'y'.repeat(9_000);
    const doc = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "${big}">]><r>${'&e;'.repeat(500)}</r>`;
    const started = Date.now();
    expect(() => parseForSandbox(doc, 'XML')).toThrow(/limit exceeded/i);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('does not blow up on nested (billion-laughs) entity definitions', () => {
    let entities = '<!ENTITY a0 "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx">';
    for (let i = 1; i < 10; i++) entities += `<!ENTITY a${String(i)} "${`&a${String(i - 1)};`.repeat(10)}">`;
    const doc = `<?xml version="1.0"?><!DOCTYPE r [${entities}]><r>&a9;</r>`;
    let length: number;
    try {
      length = JSON.stringify(parseForSandbox(doc, 'XML')).length;
    } catch {
      length = 0; // refusing the document is also acceptable
    }
    expect(length).toBeLessThan(1_000_000);
  });
});

// A value that looks like a number is still text. Identifiers such as MRNs,
// account numbers and ZIP codes carry leading zeros and exact digits.
describe('XML values are never treated as numbers', () => {
  const xml = (inner: string): string => `<patient>${inner}</patient>`;
  const roundTrip = (inner: string): string =>
    serializeFromSandbox(parseForSandbox(xml(inner), 'XML'), 'XML').replace(/\n\s*/g, '');

  it.each([
    ['leading zeros', '<mrn>000123</mrn>'],
    ['a ZIP code', '<zip>02134</zip>'],
    ['a trailing decimal zero', '<dose>1.0</dose>'],
    ['a long identifier', '<acct>12345678901234567890</acct>'],
    ['hexadecimal-looking text', '<code>0x1F</code>'],
    ['exponent-looking text', '<lot>1e3</lot>'],
    ['a plus sign', '<phone>+15551234567</phone>'],
    ['boolean-looking text', '<flag>true</flag>'],
    ['surrounding spaces', '<name> Smith </name>'],
    ['an empty element', '<middle></middle>'],
  ])('keeps %s exactly', (_name, inner) => {
    expect(roundTrip(inner)).toBe(xml(inner));
  });

  it('gives scripts the text, not a number', () => {
    const parsed = parseForSandbox(xml('<mrn>000123</mrn><n>42</n>'), 'XML') as { patient: Record<string, unknown> };
    expect(parsed.patient['mrn']).toBe('000123');
    expect(parsed.patient['n']).toBe('42');
  });

  it('keeps attribute values as text', () => {
    const parsed = parseForSandbox('<p id="007" ok="true"><a>1</a></p>', 'XML') as { p: Record<string, unknown> };
    expect(parsed.p['@_id']).toBe('007');
    expect(parsed.p['@_ok']).toBe('true');
  });

  it('does not add text nodes for the indentation between elements', () => {
    const parsed = parseForSandbox('<p>\n  <a>1</a>\n  <b>2</b>\n</p>', 'XML');
    expect(parsed).toEqual({ p: { a: '1', b: '2' } });
  });

  it('keeps escaped characters escaped on the way out', () => {
    expect(roundTrip('<t>a &amp; b &lt; c</t>')).toBe(xml('<t>a &amp; b &lt; c</t>'));
  });
});

describe('JSON numbers that cannot be held exactly', () => {
  it('keeps the digits of an integer beyond the safe range by giving it as text', () => {
    const parsed = parseForSandbox('{"id":12345678901234567890,"n":42}', 'JSON');
    expect(parsed).toEqual({ id: '12345678901234567890', n: 42 });
  });

  it('keeps the digits of a decimal with more precision than a double', () => {
    const parsed = parseForSandbox('{"v":0.1234567890123456789}', 'JSON');
    expect(parsed).toEqual({ v: '0.1234567890123456789' });
  });

  it('keeps a number too large for a double instead of turning it into Infinity', () => {
    expect(parseForSandbox('[1e400]', 'JSON')).toEqual(['1e400']);
  });

  it.each([
    ['0'], ['-0'], ['42'], ['-7'], ['1.5'], ['1.0'], ['1.50'], ['1e3'], ['1E3'], ['1.5e-7'], ['0.1'],
    ['9007199254740991'], ['-9007199254740991'], ['123.456'], ['100'], ['1e21'], ['0.000001'],
  ])('leaves the ordinary number %s a number', (literal) => {
    const parsed = parseForSandbox(`[${literal}]`, 'JSON') as unknown[];
    expect(typeof parsed[0]).toBe('number');
    expect(parsed[0]).toBe(Number(literal));
  });

  it('does not touch strings that look like numbers', () => {
    expect(parseForSandbox('{"mrn":"000123"}', 'JSON')).toEqual({ mrn: '000123' });
  });
});

describe('serializeTransformed', () => {
  it('returns the original text when a script left an XML message unchanged', () => {
    const original = '<doc><text>See <b>bold</b> note</text>\n\n<id>007</id></doc>';
    const untouched = parseForSandbox(original, 'XML');
    expect(serializeTransformed(untouched, original, 'XML')).toBe(original);
  });

  it('returns the original text when a script left a JSON message unchanged', () => {
    const original = '{ "id": 12345678901234567890,\n  "v": 1.0 }';
    expect(serializeTransformed(parseForSandbox(original, 'JSON'), original, 'JSON')).toBe(original);
  });

  it('returns the original text when a script left an HL7 message unchanged', () => {
    const original = 'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5\rPID|1||000123|||';
    expect(serializeTransformed(parseForSandbox(original, 'HL7V2'), original, 'HL7V2')).toBe(original);
  });

  it('serializes the new value when a script changed the message', () => {
    const original = '{"a":1}';
    const changed = parseForSandbox(original, 'JSON') as Record<string, unknown>;
    changed['b'] = 2;
    expect(serializeTransformed(changed, original, 'JSON')).toBe('{"a":1,"b":2}');
  });

  it('serializes the new value when a script changed an HL7 field', () => {
    const original = 'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5\rPID|1||000123';
    const msg = parseForSandbox(original, 'HL7V2') as { set: (p: string, v: string) => void };
    msg.set('PID.3', '999');
    expect(serializeTransformed(msg, original, 'HL7V2')).toContain('PID|1||999');
  });

  it('serializes a replacement string as given', () => {
    expect(serializeTransformed('replaced', '{"a":1}', 'JSON')).toBe('replaced');
  });

  it('serializes the value when the original cannot be parsed as the data type', () => {
    expect(serializeTransformed({ a: 1 }, 'not json', 'JSON')).toBe('{"a":1}');
  });
});
