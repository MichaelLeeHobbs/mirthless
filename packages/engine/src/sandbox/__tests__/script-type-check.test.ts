// The deploy check must agree with the editor: same declarations, templates and
// settings, errors reported at the line the user wrote.

import { describe, it, expect } from 'vitest';
import { checkScriptTypes } from '../script-type-check.js';

const HL7_FILTER = { dataType: 'HL7V2', destinationSet: true, templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;
const getPatientName = {
  type: 'FUNCTION',
  contexts: ['SOURCE_FILTER_TRANSFORMER'],
  code: 'function getPatientName(raw) {\n  return parseHL7(raw).get("PID.5.1") ?? "";\n}',
};

async function errors(script: string, templates: Parameters<typeof checkScriptTypes>[2] = []): Promise<string[]> {
  const result = await checkScriptTypes(script, HL7_FILTER, templates);
  if (!result.ok) throw result.error;
  return result.value.map((e) => `${String(e.line)}:${String(e.column)} ${e.message}`);
}

describe('checkScriptTypes', () => {
  it('passes a clean script that returns and awaits at the top level', async () => {
    expect(await errors("const mrn = msg.get('PID.3.1');\nawait getResource('x');\nreturn mrn !== undefined;")).toEqual([]);
  });

  it('reports each type error at the line and column the user wrote', async () => {
    expect(await errors("const port: number = '6661';\nlogger.inf('x');\nmsg.gett('PID.3');")).toEqual([
      "1:7 Type 'string' is not assignable to type 'number'.",
      "2:8 Property 'inf' does not exist on type 'SandboxLogger'. Did you mean 'info'?",
      "3:5 Property 'gett' does not exist on type 'Hl7MessageProxy'. Did you mean 'get'?",
    ]);
  });

  it('reports a syntax error too', async () => {
    const found = await errors('function normalize(value {\n  return value;\n}');
    expect(found[0]).toMatch(/^1:\d+ ',' expected\.$/);
  });

  it('sees code templates enabled for the context, with their return types', async () => {
    expect(await errors('const name: string = getPatientName(rawData);', [getPatientName])).toEqual([]);
    expect(await errors('const n: number = getPatientName(rawData);', [getPatientName])).toEqual([
      "1:7 Type 'string' is not assignable to type 'number'.",
    ]);
  });

  it('does not blame the script for a mistake inside a template', async () => {
    const broken = { ...getPatientName, code: 'function getPatientName(raw) {\n  return raw.nope.deeper;\n}' };
    expect(await errors('getPatientName(rawData);', [broken])).toEqual([]);
  });
});
