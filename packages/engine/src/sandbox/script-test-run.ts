// Runs one script against a sample as the pipeline would (same compilers, templates and data
// type parsing) with no side effects: bridges that send, write or route throw instead of acting.

import type { Result } from '@galvanigraph/core-util';
import { tryCatch } from '@galvanigraph/core-util';
import { templateDeclarations, type ScriptSurface, type ScriptTestResult, type TemplateSource } from '@galvanigraph/core-models';
import { compileScript, compileFilterRulesToScript, compileTransformerStepsToScript } from './script-compiler.js';
import { VmSandboxExecutor } from './sandbox-executor.js';
import { createSandboxContext, type SandboxContext } from './sandbox-context.js';
import type { BridgeDependencies, CollectionBridge } from './bridge-functions.js';
import { parseForSandbox, serializeFromSandbox } from '../pipeline/data-type-handler.js';
import { DestinationSet, createDestinationSetProxy } from '../pipeline/destination-set.js';

export const MAX_TEST_LOG_LINES = 200;
/** Also caps the returned value. */
export const MAX_TEST_OUTPUT_CHARS = 256 * 1024;

/** How the pipeline reads the script's result. */
export type ScriptTestKind = 'filter' | 'transformer' | 'script';

export interface ScriptTestReaders {
  readonly getResource?: BridgeDependencies['getResource'];
  readonly collectionFind?: CollectionBridge['find'];
}

export interface ScriptTestInput {
  readonly script: string;
  readonly kind: ScriptTestKind;
  /** Its data type parses the sample; omit dataType for scripts with no message. */
  readonly surface: ScriptSurface;
  readonly templates: readonly TemplateSource[];
  readonly sample: string;
  /** The channel's destinations, for destinationSet in source scripts. */
  readonly destinations?: ReadonlyArray<{ readonly name: string; readonly metaDataId: number }>;
  readonly timeoutMs: number;
  readonly readers?: ScriptTestReaders;
  /** Called once the sample is parsed and the script compiled, just before it runs. */
  readonly onCompiled?: () => void;
}

export type { ScriptTestResult };

/** The pipeline's rule: a returned value replaces the message unless it is nothing or a boolean. */
function replacement(returnValue: unknown, msg: unknown): unknown {
  return returnValue != null && typeof returnValue !== 'boolean' ? returnValue : msg;
}

function asText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function dryBridges(readers: ScriptTestReaders | undefined, skipped: string[]): BridgeDependencies {
  const refuse = (call: string): never => {
    skipped.push(call);
    throw new Error(`${call} was not run: a test run does not send, write or route anything.`);
  };
  return {
    httpFetch: async (url) => refuse(`httpFetch ${url}`),
    dbQuery: async (dataSource) => refuse(`dbQuery on "${dataSource}"`),
    routeMessage: async (channel) => refuse(`routeMessage to "${channel}"`),
    getResource: readers?.getResource ?? (async (name) => refuse(`getResource "${name}"`)),
    collections: {
      find: readers?.collectionFind ?? (async (name) => refuse(`collection "${name}" find`)),
      store: async (name) => refuse(`collection "${name}" store`),
      update: async (name) => refuse(`collection "${name}" update`),
      delete: async (name) => refuse(`collection "${name}" delete`),
    },
  };
}

function scriptBody(input: ScriptTestInput): Result<string> {
  if (input.kind === 'filter') {
    const r = compileFilterRulesToScript([{ enabled: true, type: 'JAVASCRIPT', operator: 'AND', script: input.script }]);
    return r.ok ? { ok: true, value: r.value ?? 'return true;', error: null } : r;
  }
  if (input.kind === 'transformer') {
    const r = compileTransformerStepsToScript([{ enabled: true, type: 'JAVASCRIPT', script: input.script }]);
    return r.ok ? { ok: true, value: r.value ?? '', error: null } : r;
  }
  return { ok: true, value: input.script, error: null };
}

function errorResult(error: string, started: number, logs: ScriptTestResult['logs'] = [], skipped: readonly string[] = []): ScriptTestResult {
  return {
    outcome: 'error', output: null, returned: null, logs, maps: {}, destinations: null,
    skipped, error, durationMs: Date.now() - started,
  };
}

export async function runScriptTest(input: ScriptTestInput): Promise<Result<ScriptTestResult>> {
  return tryCatch(async (): Promise<ScriptTestResult> => {
    const started = Date.now();
    const dataType = input.surface.dataType;

    let parsed: unknown = input.sample;
    if (dataType !== undefined) {
      try {
        parsed = parseForSandbox(input.sample, dataType);
      } catch (err: unknown) {
        return errorResult(`The sample is not valid ${dataType}: ${err instanceof Error ? err.message : String(err)}`, started);
      }
    }

    const body = scriptBody(input);
    if (!body.ok) return errorResult(body.error.message, started);
    const library = templateDeclarations(input.templates, input.surface);
    const compiled = await compileScript(library === '' ? body.value : `${library}\n${body.value}`, { sourcefile: 'test-run.ts' });
    if (!compiled.ok) return errorResult(compiled.error.message, started);

    const destSet = input.surface.destinationSet === true ? new DestinationSet(input.destinations ?? []) : null;
    const base = createSandboxContext(parsed, input.sample, parsed);
    const context: SandboxContext = destSet ? { ...base, extras: { destinationSet: createDestinationSetProxy(destSet) } } : base;

    const skipped: string[] = [];
    const sandbox = new VmSandboxExecutor(dryBridges(input.readers, skipped));
    input.onCompiled?.();
    const result = await sandbox.execute(compiled.value, context, { timeout: input.timeoutMs });
    if (!result.ok) return errorResult(result.error.message, started, [], skipped);

    const { returnValue, msg, logs, mapUpdates } = result.value;
    // A loop that logs or builds a huge message must not send megabytes back to the browser.
    const logLines = logs.slice(0, MAX_TEST_LOG_LINES).map((l) => ({ level: l.level, message: l.message }));
    if (logs.length > MAX_TEST_LOG_LINES) {
      logLines.push({ level: 'INFO', message: `${String(logs.length - MAX_TEST_LOG_LINES)} more logger lines not shown` });
    }
    const filter = input.kind === 'filter';
    let output: string | null = null;
    if (!filter && dataType !== undefined) {
      const value = replacement(returnValue, msg);
      output = value == null ? null : serializeFromSandbox(value, dataType, input.sample);
    }
    if (output !== null && output.length > MAX_TEST_OUTPUT_CHARS) {
      output = output.slice(0, MAX_TEST_OUTPUT_CHARS);
      logLines.push({ level: 'INFO', message: `Output cut to the first ${String(MAX_TEST_OUTPUT_CHARS)} characters` });
    }
    const returned = returnValue === msg ? null : asText(returnValue);
    return {
      outcome: filter ? (returnValue === true ? 'accepted' : 'filtered') : 'completed',
      output,
      // Compiled transformer steps end with `return msg`: that is the output, not a returned value.
      returned: returned === null ? null : returned.slice(0, MAX_TEST_OUTPUT_CHARS),
      logs: logLines,
      maps: Object.fromEntries(Object.entries(mapUpdates).filter(([, entries]) => Object.keys(entries).length > 0)),
      destinations: destSet ? [...destSet.getConnectorNames()] : null,
      skipped,
      error: null,
      durationMs: Date.now() - started,
    };
  });
}
