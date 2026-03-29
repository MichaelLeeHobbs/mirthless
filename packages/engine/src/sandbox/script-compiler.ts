// ===========================================
// Script Compiler
// ===========================================
// Transpiles TypeScript user scripts to JavaScript using esbuild.
// Returns CompiledScript objects ready for sandbox execution.

import { transform } from 'esbuild';
import type { Result } from '@mirthless/core-util';
import { tryCatch } from '@mirthless/core-util';
import type { CompiledScript } from './sandbox-executor.js';

// ----- Compile Options -----

export interface CompileOptions {
  readonly sourcefile?: string;
  readonly sourcemap?: boolean;
}

const DEFAULT_COMPILE_OPTIONS: CompileOptions = {
  sourcefile: 'script.ts',
  sourcemap: true,
} as const;

// ----- Compiler -----

/** Script cache keyed by source code hash. */
const scriptCache = new Map<string, CompiledScript>();

/** Compile TypeScript source to JavaScript via esbuild. */
export async function compileScript(
  code: string,
  options?: CompileOptions,
): Promise<Result<CompiledScript>> {
  return tryCatch(async () => {
    const cached = scriptCache.get(code);
    if (cached) return cached;

    const opts = { ...DEFAULT_COMPILE_OPTIONS, ...options };

    const transformOptions: Parameters<typeof transform>[1] = {
      loader: 'ts',
      target: 'es2022',
      sourcemap: opts.sourcemap ? 'inline' : false,
    };
    if (opts.sourcefile) {
      transformOptions.sourcefile = opts.sourcefile;
    }

    const result = await transform(code, transformOptions);

    const compiled: CompiledScript = result.map
      ? { code: result.code, sourceMap: result.map }
      : { code: result.code };

    scriptCache.set(code, compiled);
    return compiled;
  });
}

/** Clear the script compilation cache. */
export function clearScriptCache(): void {
  scriptCache.clear();
}

// ----- Filter/Transformer Compilation -----

/** A single filter rule for compilation. */
export interface FilterRuleInput {
  readonly enabled: boolean;
  readonly operator: string;
  readonly type: string;
  readonly script: string | null;
}

/** Compile filter rules into a single boolean-returning script. */
export function compileFilterRulesToScript(
  rules: ReadonlyArray<FilterRuleInput>,
): string | null {
  const jsRules = rules.filter((r) => r.enabled && r.type === 'JAVASCRIPT' && r.script);
  if (jsRules.length === 0) return null;

  if (jsRules.length === 1) {
    return `return (function() { ${jsRules[0]!.script!} })();`;
  }

  // Combine rules with their operators (first rule's operator is ignored, subsequent rules define connector)
  const parts: string[] = [];
  for (let i = 0; i < jsRules.length; i++) {
    const rule = jsRules[i]!;
    const wrapped = `(function() { ${rule.script!} })()`;
    if (i === 0) {
      parts.push(wrapped);
    } else {
      const op = rule.operator === 'OR' ? '||' : '&&';
      parts.push(` ${op} ${wrapped}`);
    }
  }

  return `return ${parts.join('')};`;
}

/** A single transformer step for compilation. */
export interface TransformerStepInput {
  readonly enabled: boolean;
  readonly type: string;
  readonly script: string | null;
}

/** Compile transformer steps into a sequential execution script. */
export function compileTransformerStepsToScript(
  steps: ReadonlyArray<TransformerStepInput>,
): string | null {
  const jsSteps = steps.filter((s) => s.enabled && s.type === 'JAVASCRIPT' && s.script);
  if (jsSteps.length === 0) return null;

  const lines = jsSteps.map((s) => s.script!);
  return `${lines.join('\n')}\nreturn msg;`;
}
