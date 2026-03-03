// ===========================================
// Batch Processor
// ===========================================
// Splits inbound content into multiple messages based on a configured mode.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SandboxExecutor, CompiledScript, ExecutionOptions, ExecutionResult } from '../sandbox/sandbox-executor.js';
import { createSandboxContext } from '../sandbox/sandbox-context.js';

// ----- Types -----

export const BATCH_MODE = {
  DISABLED: 'DISABLED',
  SPLIT_BY_DELIMITER: 'SPLIT_BY_DELIMITER',
  SPLIT_BY_REGEX: 'SPLIT_BY_REGEX',
  SPLIT_BY_JAVASCRIPT: 'SPLIT_BY_JAVASCRIPT',
} as const;

export type BatchMode = typeof BATCH_MODE[keyof typeof BATCH_MODE];

export interface BatchConfig {
  readonly mode: BatchMode;
  readonly delimiter?: string | undefined;
  readonly regexPattern?: string | undefined;
  readonly script?: CompiledScript | undefined;
}

/** Options for JavaScript-based batch splitting. */
export interface BatchJsOptions {
  readonly sandbox: SandboxExecutor;
  readonly execOptions: ExecutionOptions;
}

// ----- Processor -----

export class BatchProcessor {
  private readonly jsOptions?: BatchJsOptions | undefined;

  constructor(jsOptions?: BatchJsOptions | undefined) {
    this.jsOptions = jsOptions;
  }

  /** Split content into individual messages based on batch config. */
  async split(content: string, config: BatchConfig): Promise<Result<readonly string[]>> {
    return tryCatch(async () => {
      if (content.length === 0) {
        return [];
      }

      switch (config.mode) {
        case BATCH_MODE.DISABLED:
          return [content];

        case BATCH_MODE.SPLIT_BY_DELIMITER:
          return this.splitByDelimiter(content, config.delimiter ?? '');

        case BATCH_MODE.SPLIT_BY_REGEX:
          return this.splitByRegex(content, config.regexPattern ?? '');

        case BATCH_MODE.SPLIT_BY_JAVASCRIPT:
          return this.splitByJavaScript(content, config.script);

        default: {
          const _exhaustive: never = config.mode;
          return [content];
        }
      }
    });
  }

  private splitByDelimiter(content: string, delimiter: string): readonly string[] {
    if (delimiter.length === 0) {
      return [content];
    }

    const parts = content.split(delimiter);
    return parts.filter((p) => p.length > 0);
  }

  private splitByRegex(content: string, pattern: string): readonly string[] {
    if (pattern.length === 0) {
      return [content];
    }

    const regex = new RegExp(pattern);
    const parts = content.split(regex);
    return parts.filter((p) => p.length > 0);
  }

  private async splitByJavaScript(
    content: string,
    script?: CompiledScript | undefined,
  ): Promise<readonly string[]> {
    if (!script || !this.jsOptions) {
      return [content];
    }

    const { sandbox, execOptions } = this.jsOptions;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), execOptions.timeout);

    try {
      const context = createSandboxContext(content, content, content);
      const result: Result<ExecutionResult> = await sandbox.execute(
        script, context, { ...execOptions, signal: ac.signal },
      );

      if (!result.ok) {
        return [content];
      }

      const returnValue = result.value.returnValue;
      if (Array.isArray(returnValue)) {
        return (returnValue as unknown[])
          .filter((v): v is string => typeof v === 'string' && v.length > 0);
      }

      return [content];
    } finally {
      clearTimeout(timeout);
    }
  }
}
