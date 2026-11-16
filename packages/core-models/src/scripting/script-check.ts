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

/**
 * Diagnostics that are not errors in a script. The engine runs every script as
 * the body of an async function, so a top-level `return` and `await` are allowed.
 */
export const IGNORED_SCRIPT_DIAGNOSTICS: readonly number[] = [
  1108, // A 'return' statement can only be used within a function body.
  1375, // 'await' expressions are only allowed at the top level of a file when that file is a module.
  1378, // Top-level 'await' expressions are only allowed when the 'module' option is set to ...
];
