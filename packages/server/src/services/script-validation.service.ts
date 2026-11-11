// ===========================================
// Script Validation Service
// ===========================================
// Validates JavaScript/TypeScript syntax using esbuild transform.
// Syntax errors are returned as successful results with valid=false,
// since the service call itself succeeded. Only infrastructure errors
// (esbuild crash) would return ok=false.

import { transform } from 'esbuild';
import type { Result } from 'stderr-lib';
import { compileScript } from '@galvaniflow/engine';
import { ServiceError } from '../lib/service-error.js';

// ----- Types -----

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly string[];
}

type ScriptLanguage = 'javascript' | 'typescript';

// ----- Service -----

export class ScriptValidationService {
  /** Validate JavaScript or TypeScript syntax using esbuild. */
  static async validate(
    script: string,
    language: ScriptLanguage,
  ): Promise<Result<ValidationResult>> {
    if (script.trim().length === 0) {
      return { ok: true, value: { valid: true }, error: null };
    }

    const loader = language === 'typescript' ? ('ts' as const) : ('js' as const);

    try {
      await transform(script, { loader, target: 'es2022' });
      return { ok: true, value: { valid: true }, error: null };
    } catch (err: unknown) {
      const errors = extractEsbuildErrors(err);
      return { ok: true, value: { valid: false, errors }, error: null };
    }
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

// ----- Helpers -----

interface EsbuildError {
  readonly text: string;
  readonly location?: { readonly line: number; readonly column: number } | null;
}

/** Extract human-readable error messages from an esbuild error. */
function extractEsbuildErrors(err: unknown): readonly string[] {
  if (err !== null && typeof err === 'object' && 'errors' in err) {
    const esbuildErr = err as { readonly errors: readonly EsbuildError[] };
    return esbuildErr.errors.map((e) => {
      if (e.location) {
        return `Line ${String(e.location.line)}: ${e.text}`;
      }
      return e.text;
    });
  }
  if (err instanceof Error) {
    return [err.message];
  }
  return ['Unknown syntax error'];
}
