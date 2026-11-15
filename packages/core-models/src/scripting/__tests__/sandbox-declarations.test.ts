// The declarations are only useful if TypeScript accepts them and they give
// scripts the types the engine really passes, so these tests compile scripts
// against them with the same settings the editor and the deploy check use.

import { describe, it, expect, vi } from 'vitest';
import ts from 'typescript';
import {
  scriptDeclarations, scriptSurfaceKey, templateDeclarations, type ScriptSurface, type TemplateSource,
} from '../sandbox-declarations.js';
import { SCRIPT_COMPILER_OPTIONS, IGNORED_SCRIPT_DIAGNOSTICS } from '../script-check.js';

// Each check builds a real TypeScript program: about a second alone, several under
// the gate's coverage and parallel workers, so the 5 s default is too short.
vi.setConfig({ testTimeout: 30_000 });

// Parse TypeScript's lib files once per file run instead of once per check.
const libCache = new Map<string, ts.SourceFile | undefined>();

function cachedLib(
  name: string, lang: ts.ScriptTarget | ts.CreateSourceFileOptions, read: (n: string, l: ts.ScriptTarget | ts.CreateSourceFileOptions) => ts.SourceFile | undefined,
): ts.SourceFile | undefined {
  if (!libCache.has(name)) libCache.set(name, read(name, lang));
  return libCache.get(name);
}

/** Type-check one script against a surface; returns the messages TypeScript reports. */
function check(script: string | readonly string[], surface: ScriptSurface, templates: readonly TemplateSource[] = []): string[] {
  const scripts = typeof script === 'string' ? [script] : script;
  const files: Record<string, string> = {
    '/sandbox.d.ts': scriptDeclarations(surface),
    '/templates.d.ts': templateDeclarations(templates, surface),
  };
  scripts.forEach((s, i) => { files[i === 0 ? '/script.ts' : `/script${String(i)}.ts`] = s; });
  const options: ts.CompilerOptions = { ...SCRIPT_COMPILER_OPTIONS, lib: ['lib.es2022.d.ts'] } as ts.CompilerOptions;
  const host = ts.createCompilerHost(options);
  const readLib = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang): ts.SourceFile | undefined =>
    files[name] === undefined ? cachedLib(name, lang, readLib) : ts.createSourceFile(name, files[name], lang, true);
  host.fileExists = (name): boolean => files[name] !== undefined || ts.sys.fileExists(name);
  const program = ts.createProgram(Object.keys(files), options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => !IGNORED_SCRIPT_DIAGNOSTICS.includes(d.code) && !d.file?.fileName.endsWith('.d.ts'))
    .map((d) => `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

describe('scriptDeclarations', () => {
  it('compiles cleanly for every data type', () => {
    for (const dataType of ['HL7V2', 'X12', 'JSON', 'XML', 'DELIMITED', 'RAW', undefined]) {
      expect(check('export {};', { dataType, destinationSet: true }), String(dataType)).toEqual([]);
    }
  });

  it('types msg as the HL7 proxy in an HL7 v2 channel, with top-level return and await allowed', () => {
    expect(check("const mrn: string | undefined = msg.get('PID.3.1');\nawait getResource('x');\nreturn mrn;", { dataType: 'HL7V2' })).toEqual([]);
    expect(check("msg.gett('PID.3.1');", { dataType: 'HL7V2' })).toEqual([
      "/script.ts: Property 'gett' does not exist on type 'Hl7MessageProxy'. Did you mean 'get'?",
    ]);
  });

  it('types msg as text for pass-through data types and rows for delimited', () => {
    expect(check('const s: string = msg.toUpperCase();', { dataType: 'RAW' })).toEqual([]);
    expect(check('const first: string | undefined = msg[0]?.["name"];', { dataType: 'DELIMITED' })).toEqual([]);
  });

  it('leaves msg unknown when the script is not tied to one data type', () => {
    expect(check("msg.get('PID.3');", {})).toEqual(["/script.ts: 'msg' is of type 'unknown'."]);
  });

  it('declares destinationSet only for source filters and transformers', () => {
    expect(check("destinationSet.remove('To EHR');", { dataType: 'HL7V2', destinationSet: true })).toEqual([]);
    expect(check("destinationSet.remove('To EHR');", { dataType: 'HL7V2' })).toEqual(["/script.ts: Cannot find name 'destinationSet'."]);
  });

  it('reports a wrong argument type against a sandbox function', () => {
    expect(check("const n: number = '6661';\nlogger.inf('x');", {})).toEqual([
      "/script.ts: Type 'string' is not assignable to type 'number'.",
      "/script.ts: Property 'inf' does not exist on type 'SandboxLogger'. Did you mean 'info'?",
    ]);
  });

  it('keeps two scripts that declare the same name from colliding', () => {
    // Each script is its own module (moduleDetection force), so a second script's
    // `const hl7` must not be "Cannot redeclare block-scoped variable".
    const both = ['const hl7 = parseHL7(rawData);', 'const hl7 = parseHL7(rawData);'];
    expect(check(both, { dataType: 'HL7V2' })).toEqual([]);
  });
});

describe('templateDeclarations', () => {
  const getPatientName: TemplateSource = {
    type: 'FUNCTION',
    contexts: ['SOURCE_FILTER_TRANSFORMER'],
    code: '/** Formats PID-5. */\nfunction getPatientName(raw) {\n  const hl7 = parseHL7(raw);\n  return hl7.get("PID.5.1") + ", " + hl7.get("PID.5.2");\n}',
  };
  const filter: ScriptSurface = { dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER' };

  it('lets a script call a template enabled for its context, with its inferred return type', () => {
    expect(check('const name: string = getPatientName(rawData);', filter, [getPatientName])).toEqual([]);
    expect(check('const n: number = getPatientName(rawData);', filter, [getPatientName])).toEqual([
      "/script.ts: Type 'string' is not assignable to type 'number'.",
    ]);
  });

  it('hides templates not enabled for the script context, as the engine does', () => {
    const deploy: ScriptSurface = { templateContext: 'CHANNEL_DEPLOY' };
    expect(check('getPatientName(rawData);', deploy, [getPatientName])).toEqual(["/script.ts: Cannot find name 'getPatientName'."]);
    expect(templateDeclarations([getPatientName], {})).toBe('');
  });

  it('skips CODE_BLOCK templates, which the engine does not prepend', () => {
    expect(templateDeclarations([{ ...getPatientName, type: 'CODE_BLOCK' }], filter)).toBe('');
  });
});

describe('scriptSurfaceKey', () => {
  it('differs when the data type or destinationSet differs', () => {
    const keys = new Set([
      scriptSurfaceKey({}), scriptSurfaceKey({ dataType: 'HL7V2' }),
      scriptSurfaceKey({ dataType: 'HL7V2', destinationSet: true }), scriptSurfaceKey({ dataType: 'JSON' }),
    ]);
    expect(keys.size).toBe(4);
  });
});
