// ===========================================
// Sandbox Executor
// ===========================================
// Interface for safe JavaScript execution and a Node.js vm-based
// implementation. The interface allows swapping to isolated-vm
// in production without changing consuming code.

import * as vm from 'node:vm';
import type { Result } from '@mirthless/core-util';
import { tryCatch } from '@mirthless/core-util';
import type { SandboxContext, LogEntry } from './sandbox-context.js';
import { createBridgeFunctions, type BridgeDependencies } from './bridge-functions.js';

// ----- Types -----

/** A compiled script ready for execution. */
export interface CompiledScript {
  readonly code: string;
  readonly sourceMap?: string;
}

/** Options for script execution. */
export interface ExecutionOptions {
  readonly timeout: number;
  readonly memoryLimit: number;
  readonly signal: AbortSignal;
}

/** Result of executing a script in the sandbox. */
export interface ExecutionResult {
  readonly returnValue: unknown;
  readonly mapUpdates: {
    readonly channelMap: Readonly<Record<string, unknown>>;
    readonly connectorMap: Readonly<Record<string, unknown>>;
    readonly globalChannelMap: Readonly<Record<string, unknown>>;
    readonly globalMap: Readonly<Record<string, unknown>>;
  };
  readonly logs: readonly LogEntry[];
}

/** Default execution options. */
export const DEFAULT_EXECUTION_OPTIONS: ExecutionOptions = {
  timeout: 30_000,
  memoryLimit: 128 * 1024 * 1024,
  signal: AbortSignal.timeout(30_000),
} as const;

// ----- Interface -----

/** Sandbox executor interface. Implementations provide script isolation. */
export interface SandboxExecutor {
  /** Execute a compiled script with the given context. */
  execute(
    script: CompiledScript,
    context: SandboxContext,
    options: ExecutionOptions,
  ): Promise<Result<ExecutionResult>>;

  /** Release all resources held by this executor. */
  dispose(): void;
}

// ----- VM Implementation -----

/**
 * Node.js vm-based sandbox executor.
 * Uses vm.runInNewContext for script isolation.
 * NOT suitable for untrusted code in production — use isolated-vm there.
 * Suitable for development and testing.
 */
export class VmSandboxExecutor implements SandboxExecutor {
  private readonly deps: BridgeDependencies | undefined;

  constructor(deps?: BridgeDependencies) {
    this.deps = deps;
  }

  async execute(
    script: CompiledScript,
    context: SandboxContext,
    options: ExecutionOptions,
  ): Promise<Result<ExecutionResult>> {
    return tryCatch(async () => {
      if (options.signal.aborted) {
        throw new Error('Execution aborted before start');
      }

      const logs: LogEntry[] = [];
      const channelMap = { ...context.channelMap };
      const connectorMap = { ...context.connectorMap };
      const globalChannelMap = { ...(context.globalChannelMap ?? {}) };
      const globalMap = { ...(context.globalMap ?? {}) };
      const configMap: Readonly<Record<string, unknown>> = context.configMap
        ? Object.freeze({ ...context.configMap })
        : Object.freeze({} as Record<string, unknown>);
      const responseMap = { ...context.responseMap };
      const sourceMap = { ...context.sourceMap };

      const logger = {
        info: (message: string): void => { logs.push({ level: 'INFO', message, timestamp: new Date() }); },
        warn: (message: string): void => { logs.push({ level: 'WARN', message, timestamp: new Date() }); },
        error: (message: string): void => { logs.push({ level: 'ERROR', message, timestamp: new Date() }); },
        debug: (message: string): void => { logs.push({ level: 'DEBUG', message, timestamp: new Date() }); },
      };

      const bridges = createBridgeFunctions(this.deps);

      // Map shorthand functions
      const $ = (...args: unknown[]): unknown => {
        const key = args[0] as string;
        const lookupOrder = [responseMap, connectorMap, channelMap, globalChannelMap, globalMap, configMap, sourceMap];
        for (const map of lookupOrder) {
          const val = (map as Record<string, unknown>)[key];
          if (val !== undefined) return val;
        }
        return undefined;
      };

      const $r = (...args: unknown[]): unknown => {
        const key = args[0] as string;
        if (args.length >= 2) {
          responseMap[key] = args[1];
          return undefined;
        }
        return responseMap[key];
      };

      const $g = (...args: unknown[]): unknown => {
        const key = args[0] as string;
        if (args.length >= 2) {
          globalMap[key] = args[1];
          return undefined;
        }
        return globalMap[key];
      };

      const $gc = (key: string): unknown => {
        return configMap[key];
      };

      const sandbox: Record<string, unknown> = {
        msg: context.msg,
        tmp: context.tmp,
        rawData: context.rawData,
        sourceMap,
        channelMap,
        connectorMap,
        globalChannelMap,
        globalMap,
        configMap,
        responseMap,
        logger,
        parseHL7: bridges.parseHL7,
        createACK: bridges.createACK,
        $,
        $r,
        $g,
        $gc,
        ...(bridges.httpFetch ? { httpFetch: bridges.httpFetch } : {}),
        ...(bridges.dbQuery ? { dbQuery: bridges.dbQuery } : {}),
        ...(bridges.routeMessage ? { routeMessage: bridges.routeMessage } : {}),
        ...(bridges.getResource ? { getResource: bridges.getResource } : {}),
        ...(context.extras ?? {}),
        __result: undefined,
      };

      // Use async IIFE to support await in user scripts when IO bridges are present
      const hasAsyncBridges = this.deps?.httpFetch || this.deps?.dbQuery || this.deps?.routeMessage || this.deps?.getResource;
      const wrappedCode = hasAsyncBridges
        ? `'use strict'; __result = (async function() {\n${script.code}\n})();`
        : `'use strict'; __result = (function() {\n${script.code}\n})();`;

      vm.createContext(sandbox);
      vm.runInContext(wrappedCode, sandbox, { timeout: options.timeout });

      // If async IIFE, await the result (cannot use instanceof Promise — cross-realm)
      if (hasAsyncBridges) {
        sandbox['__result'] = await sandbox['__result'];
      }

      return {
        returnValue: sandbox['__result'],
        mapUpdates: { channelMap, connectorMap, globalChannelMap, globalMap },
        logs,
      };
    });
  }

  dispose(): void {
    // No resources to release for vm-based executor
  }
}
