// The deploy check must agree with the editor: same declarations, templates and
// settings, errors reported at the line the user wrote.

import { describe, it, expect } from 'vitest';
import { checkScriptTypes, onlySyntaxWhileBroken } from '../script-type-check.js';

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

  it('reports a syntax error too, marked as one, and keeps only those while the script does not parse', async () => {
    const result = await checkScriptTypes('function normalize(value {\n  return value;\n}', HL7_FILTER, []);
    if (!result.ok) throw result.error;
    expect(result.value.some((e) => e.syntax && /^',' expected\.$/.test(e.message))).toBe(true);
    const shown = onlySyntaxWhileBroken(result.value);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((e) => e.syntax)).toBe(true);
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

// #206: TypeScript does not check the expression of a `return` outside a
// function, so the check runs the script as the body of the function the engine
// runs it in.
describe('checkScriptTypes on a top-level return', () => {
  const NO_MESSAGE = { message: false } as const;
  const noMessageErrors = async (script: string): Promise<string[]> => {
    const result = await checkScriptTypes(script, NO_MESSAGE, []);
    if (!result.ok) throw result.error;
    return result.value.map((e) => `${String(e.line)}:${String(e.column)} ${e.message}`);
  };

  it.each([
    ["msg.get('MSH.10');", ["1:1 Cannot find name 'msg'."]],
    ["return [msg.get('MSH.10')];", ["1:9 Cannot find name 'msg'."]],
    ["const x = [msg.get('MSH.10')];\nreturn x;", ["1:12 Cannot find name 'msg'."]],
  ])('reports the error in %j', async (script, expected) => {
    expect(await noMessageErrors(script)).toEqual(expected);
  });

  it('reports a type error in a returned expression on the line the user wrote', async () => {
    expect(await errors("logger.info('x');\nif (rawData === '') {\n  return msg.gett('PID.3');\n}\nreturn true;")).toEqual([
      "3:14 Property 'gett' does not exist on type 'Hl7MessageProxy'. Did you mean 'get'?",
    ]);
  });

  it('still allows a top-level return and await, and keeps declarations local to the script', async () => {
    expect(await noMessageErrors("const r = await routeMessage('Archive', 'x');\nfunction f(): number { return 1; }\nreturn f() > 0 && r.filtered;")).toEqual([]);
  });

  it('puts an error at the end of the script when a block is left open', async () => {
    const result = await checkScriptTypes('if (true) {\n  logger.info("x");', NO_MESSAGE, []);
    if (!result.ok) throw result.error;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.every((e) => e.line >= 1 && e.line <= 2)).toBe(true);
  });
});
