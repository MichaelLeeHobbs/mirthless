// ===========================================
// Script type-check settings
// ===========================================
// The compiler settings for checking TypeScript scripts, shared by the web
// editor and the server's deploy check so both report the same errors.

/**
 * TypeScript compiler options for user scripts. Numeric enum values, because
 * the editor's bundled TypeScript and the server's are different copies.
 */
export const SCRIPT_COMPILER_OPTIONS = {
  /** ScriptTarget.ES2022: the engine compiles scripts for es2022. */
  target: 9,
  /** ModuleKind.ESNext. */
  module: 99,
  /**
   * ModuleDetectionKind.Force: each script is its own module, so two scripts
   * that both declare `const hl7` do not collide.
   */
  moduleDetection: 3,
  /** No DOM: scripts run in the engine, not a browser. */
  lib: ['es2022'],
  strict: true,
  noEmit: true,
  allowNonTsExtensions: true,
} as const;

/** The first line of the function the engine runs every script in. */
export const SCRIPT_BODY_OPEN = 'async function __galvaniflowScript() {';

/**
 * A script as the body of the function the engine runs it in, which is how the
 * compiler builds it and how the type checks check it: TypeScript does not
 * check the expression of a `return` outside a function (#206). Line N of the
 * script is line N + 1 of the result, at the same column.
 */
export function wrapScriptBody(code: string): string {
  return `${SCRIPT_BODY_OPEN}\n${code}\n}`;
}

/**
 * A 1-based line and column in {@link wrapScriptBody}'s output, on the
 * script's own lines. A position on the wrapper's first line goes to the
 * script's start, one on its closing brace (an unclosed block, say) to the
 * script's end.
 */
export function scriptBodyPosition(code: string, line: number, column: number): { readonly line: number; readonly column: number } {
  const lines = code.split('\n');
  if (line < 2) return { line: 1, column: 1 };
  if (line > lines.length + 1) return { line: lines.length, column: (lines.at(-1) ?? '').length + 1 };
  return { line: line - 1, column };
}
