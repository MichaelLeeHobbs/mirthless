// ===========================================
// Script type check
// ===========================================
// Type-checks a TypeScript user script the way the web editor does: the same
// sandbox declarations (msg typed by data type), the same code templates and
// the same compiler settings, all from core-models. Deploy uses it to refuse a
// channel whose TypeScript scripts have type errors. esbuild, which compiles
// scripts, does not type-check.
//
// TypeScript is loaded on first use, so the engine does not pay for it at start.

import type { Result } from '@galvaniflow/core-util';
import { tryCatch } from '@galvaniflow/core-util';
import {
  IGNORED_SCRIPT_DIAGNOSTICS, SCRIPT_COMPILER_OPTIONS, scriptDeclarations, templateDeclarations,
  type ScriptSurface, type TemplateSource,
} from '@galvaniflow/core-models';

/** One type error in a script. */
export interface ScriptTypeError {
  /** 1-based line in the script as the user wrote it. */
  readonly line: number;
  readonly column: number;
  readonly message: string;
  /** TypeScript diagnostic code, e.g. 2322. */
  readonly code: number;
}

const SCRIPT_FILE = '/script.ts';

/** Parsed TypeScript lib files (lib.es2022.d.ts and the files it references), by name. */
const libFiles = new Map<string, import('typescript').SourceFile | undefined>();

type TypeScript = typeof import('typescript');
let typescript: Promise<TypeScript> | undefined;

async function loadTypeScript(): Promise<TypeScript> {
  typescript ??= import('typescript').then((m) => ('default' in m ? (m.default as TypeScript) : m));
  return typescript;
}

/**
 * Type-check one TypeScript script on its surface, with the code templates it
 * can call. Returns the errors (empty when the script is clean), sorted by line.
 */
export async function checkScriptTypes(
  script: string,
  surface: ScriptSurface,
  templates: readonly TemplateSource[],
): Promise<Result<readonly ScriptTypeError[]>> {
  return tryCatch(async () => {
    const ts = await loadTypeScript();
    const files: Readonly<Record<string, string>> = {
      '/sandbox.d.ts': scriptDeclarations(surface),
      '/code-templates.d.ts': templateDeclarations(templates, surface),
      [SCRIPT_FILE]: script,
    };
    const options: import('typescript').CompilerOptions = {
      ...(SCRIPT_COMPILER_OPTIONS as unknown as import('typescript').CompilerOptions),
      lib: SCRIPT_COMPILER_OPTIONS.lib.map((l) => `lib.${l}.d.ts`),
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const readLib = host.getSourceFile.bind(host);
    host.getSourceFile = (name, lang) => {
      const text = files[name];
      if (text !== undefined) return ts.createSourceFile(name, text, lang, true);
      // TypeScript's own lib files never change: parse each once per process.
      if (!libFiles.has(name)) libFiles.set(name, readLib(name, lang));
      return libFiles.get(name);
    };
    host.fileExists = (name) => files[name] !== undefined || ts.sys.fileExists(name);
    host.readFile = (name) => files[name] ?? ts.sys.readFile(name);
    const program = ts.createProgram(Object.keys(files), options, host);
    const source = program.getSourceFile(SCRIPT_FILE);
    // Errors inside the declaration files (a template's own mistakes) are not
    // this script's: templates are checked when they are saved.
    // A script that does not parse gets its syntax errors only: type errors in
    // code that does not parse are noise.
    const relevant = (d: import('typescript').Diagnostic): boolean => !IGNORED_SCRIPT_DIAGNOSTICS.includes(d.code);
    const syntax = program.getSyntacticDiagnostics(source).filter(relevant);
    const diagnostics = syntax.length > 0 ? syntax : program.getSemanticDiagnostics(source).filter(relevant);
    return diagnostics
      .map((d): ScriptTypeError => {
        const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
        return { line: pos.line + 1, column: pos.character + 1, message: ts.flattenDiagnosticMessageText(d.messageText, ' '), code: d.code };
      })
      .sort((a, b) => a.line - b.line || a.column - b.column);
  });
}
