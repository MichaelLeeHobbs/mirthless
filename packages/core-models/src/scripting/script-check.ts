/** Numeric enum values: the editor's bundled TypeScript and the server's are different copies. */
export const SCRIPT_COMPILER_OPTIONS = {
  /** ScriptTarget.ES2022: the engine compiles scripts for es2022. */
  target: 9,
  /** ModuleKind.ESNext. */
  module: 99,
  /** ModuleDetectionKind.Force: each script is its own module, so top-level names in two scripts do not collide. */
  moduleDetection: 3,
  /** No DOM: scripts run in the engine, not a browser. */
  lib: ['es2022'],
  strict: true,
  noEmit: true,
  allowNonTsExtensions: true,
} as const;

export const SCRIPT_BODY_OPEN = 'async function __galvanigraphScript() {';

/**
 * Wrapped because TypeScript does not check the expression of a `return`
 * outside a function (#206). Script line N is line N + 1 here, same column.
 */
export function wrapScriptBody(code: string): string {
  return `${SCRIPT_BODY_OPEN}\n${code}\n}`;
}

const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;

/**
 * Maps a 1-based position in {@link wrapScriptBody}'s output onto the script's
 * own lines, counted as TypeScript counts them. Positions on the wrapper's own
 * lines clamp to the script's start or end.
 */
export function scriptBodyPosition(code: string, line: number, column: number): { readonly line: number; readonly column: number } {
  const lines = code.split(LINE_BREAK);
  if (line < 2) return { line: 1, column: 1 };
  if (line > lines.length + 1) return { line: lines.length, column: (lines.at(-1) ?? '').length + 1 };
  return { line: line - 1, column };
}
