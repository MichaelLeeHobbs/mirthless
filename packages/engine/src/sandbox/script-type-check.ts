// Checks a script as the web editor does (the same declarations, templates and compiler
// settings, from core-models); esbuild, which compiles scripts, does not type-check.
// TypeScript is loaded on first use, so the engine does not pay for it at start.

import type { Result } from '@galvanigraph/core-util';
import { tryCatch } from '@galvanigraph/core-util';
import {
  SCRIPT_COMPILER_OPTIONS, scriptBodyPosition, scriptDeclarations, templateDeclarations,
  wrapScriptBody, type ScriptSurface, type TemplateSource,
} from '@galvanigraph/core-models';

export interface ScriptTypeError {
  /** 1-based line in the script as the user wrote it. */
  readonly line: number;
  readonly column: number;
  readonly message: string;
  /** TypeScript diagnostic code. */
  readonly code: number;
  readonly syntax: boolean;
}

/**
 * Type errors in code that does not parse are noise. Apply it to one script's errors, or one
 * part's for scripts checked joined.
 */
export function onlySyntaxWhileBroken(errors: readonly ScriptTypeError[]): readonly ScriptTypeError[] {
  return errors.some((e) => e.syntax) ? errors.filter((e) => e.syntax) : errors;
}

const SCRIPT_FILE = '/script.ts';

const libFiles = new Map<string, import('typescript').SourceFile | undefined>();

type TypeScript = typeof import('typescript');
let typescript: Promise<TypeScript> | undefined;

async function loadTypeScript(): Promise<TypeScript> {
  typescript ??= import('typescript').then((m) => ('default' in m ? (m.default as TypeScript) : m));
  return typescript;
}

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
      // Checked as the body of a function, as the engine runs it: TypeScript does not
      // check a `return` expression outside one (#206).
      [SCRIPT_FILE]: wrapScriptBody(script),
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
    // A template's own errors are not this script's: templates are checked when saved.
    // Syntax and type errors are both returned, marked: a caller checking parts joined
    // (transformer steps) must not let one part's syntax error hide another part's type
    // errors, so it applies onlySyntaxWhileBroken per part.
    const toError = (syntax: boolean) => (d: import('typescript').Diagnostic): ScriptTypeError => {
      const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
      const at = scriptBodyPosition(script, pos.line + 1, pos.character + 1);
      return { line: at.line, column: at.column, message: ts.flattenDiagnosticMessageText(d.messageText, ' '), code: d.code, syntax };
    };
    return [
      ...program.getSyntacticDiagnostics(source).map(toError(true)),
      ...program.getSemanticDiagnostics(source).map(toError(false)),
    ].sort((a, b) => a.line - b.line || a.column - b.column);
  });
}
