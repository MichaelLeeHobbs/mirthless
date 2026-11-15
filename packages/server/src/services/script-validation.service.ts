// ===========================================
// Script Validation Service
// ===========================================
// Checks a script's syntax with the compiler deploy uses, so the editor's
// verdict matches what deploy will do. Syntax errors are returned as
// successful results with valid=false, since the service call itself succeeded.

import type { Result } from 'stderr-lib';
import { compileErrorMessages, compileScript } from '@galvaniflow/engine';
import { ServiceError } from '../lib/service-error.js';

// ----- Types -----

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly string[];
}

type ScriptLanguage = 'javascript' | 'typescript';

// ----- Service -----

export class ScriptValidationService {
  /**
   * Validate a script's syntax with the deploy compiler. Deploy compiles every
   * script as TypeScript in an async function body, so `language` does not
   * change the verdict: a JavaScript script that deploys is valid here too.
   */
  static async validate(
    script: string,
    _language: ScriptLanguage,
  ): Promise<Result<ValidationResult>> {
    if (script.trim().length === 0) {
      return { ok: true, value: { valid: true }, error: null };
    }

    // A syntax check: no source map, and kept out of the cache deploy relies on.
    const compiled = await compileScript(script, { sourcemap: false, cache: false });
    if (compiled.ok) {
      return { ok: true, value: { valid: true }, error: null };
    }
    const errors = compileErrorMessages(compiled.error, script);
    return { ok: true, value: { valid: false, errors }, error: null };
  }
}

/**
 * Refuse to save a script every channel depends on when it does not compile.
 *
 * Code templates and global scripts are compiled into every channel at deploy,
 * so one syntax error in them stops every deploy, including the automatic one
 * after a restart. Uses the same compiler as deploy. Throws INVALID_INPUT.
 */
export async function assertScriptCompiles(script: string, what: string): Promise<void> {
  if (script.trim().length === 0) return;
  const compiled = await compileScript(script, { sourcefile: what });
  if (!compiled.ok) {
    throw new ServiceError('INVALID_INPUT', `${what} does not compile and was not saved: ${compiled.error.message}`);
  }
}
