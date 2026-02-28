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
