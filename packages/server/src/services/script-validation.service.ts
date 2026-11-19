import type { Result } from 'stderr-lib';
import { compileErrorMessages, compileScript } from '@galvanigraph/engine';
import { ServiceError } from '../lib/service-error.js';

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly string[];
}

type ScriptLanguage = 'javascript' | 'typescript';

export class ScriptValidationService {
  /**
   * Deploy compiles every script as TypeScript in an async function body, so
   * `language` does not change the verdict.
   */
  static async validate(
    script: string,
    _language: ScriptLanguage,
  ): Promise<Result<ValidationResult>> {
    if (script.trim().length === 0) {
      return { ok: true, value: { valid: true }, error: null };
    }

    // Kept out of the cache deploy relies on.
    const compiled = await compileScript(script, { sourcemap: false, cache: false });
    if (compiled.ok) {
      return { ok: true, value: { valid: true }, error: null };
    }
    const errors = compileErrorMessages(compiled.error, script);
    return { ok: true, value: { valid: false, errors }, error: null };
  }
}

/**
 * Code templates and global scripts are compiled into every channel at deploy,
 * so one syntax error in them stops every deploy, including the automatic one
 * after a restart. Throws INVALID_INPUT.
 */
export async function assertScriptCompiles(script: string, what: string): Promise<void> {
  if (script.trim().length === 0) return;
  // A one-off check under a label deploy never compiles with: keep it out of the cache.
  const compiled = await compileScript(script, { sourcefile: what, sourcemap: false, cache: false });
  if (!compiled.ok) {
    throw new ServiceError('INVALID_INPUT', `${what} does not compile and was not saved: ${compiled.error.message}`);
  }
}
