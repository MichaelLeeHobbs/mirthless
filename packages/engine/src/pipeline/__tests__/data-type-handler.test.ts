// ===========================================
// Data Type Handler Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { parseForSandbox, serializeFromSandbox, isHl7MessageProxy, createHl7Proxy } from '../data-type-handler.js';
import { Hl7Message } from '@mirthless/core-util';

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
    const patient = (result as { patient: { name: string; mrn: number } }).patient;
    expect(patient.name).toBe('John Doe');
    // fast-xml-parser parses numeric strings as numbers by default
    expect(patient.mrn).toBe(12345);
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
