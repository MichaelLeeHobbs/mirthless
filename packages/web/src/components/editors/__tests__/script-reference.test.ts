import { describe, it, expect } from 'vitest';
import { scriptReference } from '../script-reference.js';

const HL7_SOURCE = { dataType: 'HL7V2', destinationSet: true, templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;

describe('scriptReference', () => {
  it('lists sandbox functions with their signature, documentation and a call snippet', () => {
    const parseHL7 = scriptReference(HL7_SOURCE, []).find((e) => e.name === 'parseHL7');
    expect(parseHL7).toEqual({
      name: 'parseHL7',
      group: 'Functions',
      signatures: ['parseHL7(raw: string): Hl7MessageProxy'],
      doc: 'Parse an HL7v2 message string into a proxy object.',
      snippet: 'parseHL7(${1:raw})',
    });
  });

  it('types msg by the surface and lists it first, under Message', () => {
    const entries = scriptReference(HL7_SOURCE, []);
    const msg = entries.find((e) => e.name === 'msg');
    expect(msg?.group).toBe('Message');
    expect(msg?.signatures).toEqual(['msg: Hl7MessageProxy']);
    expect(entries[0]?.group).toBe('Message');
  });

  it('merges overloads under one name', () => {
    const c = scriptReference({}, []).find((e) => e.name === '$c');
    expect(c?.group).toBe('Maps');
    expect(c?.signatures).toEqual(['$c(key: string): unknown', '$c(key: string, value: unknown): void']);
  });

  it('takes each description from its own doc comment, not an earlier one', () => {
    // An interface with its own doc comments sits between destinationSet's doc and an earlier one.
    const ds = scriptReference(HL7_SOURCE, []).find((e) => e.name === 'destinationSet');
    expect(ds?.doc).toBe('The destinations this message will go to. Source filter and transformer only.');
  });

  it('offers destinationSet only where the script can use it', () => {
    expect(scriptReference(HL7_SOURCE, []).some((e) => e.name === 'destinationSet')).toBe(true);
    expect(scriptReference({ dataType: 'HL7V2' }, []).some((e) => e.name === 'destinationSet')).toBe(false);
  });

  it('lists code templates enabled for the context, with their documentation', () => {
    const template = {
      type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'],
      code: '/**\n * Formats PID-5 as "Last, First".\n * @param raw - the raw message\n */\nfunction getPatientName(raw: string): string {\n  return raw;\n}',
    };
    expect(scriptReference(HL7_SOURCE, [template]).find((e) => e.name === 'getPatientName')).toEqual({
      name: 'getPatientName', group: 'Code templates', signatures: ['getPatientName(raw: string)'],
      doc: 'Formats PID-5 as "Last, First".', snippet: 'getPatientName(${1:raw})',
    });
    expect(scriptReference({ templateContext: 'CHANNEL_DEPLOY' }, [template]).some((e) => e.name === 'getPatientName')).toBe(false);
  });
});
