// ===========================================
// Script test run
// ===========================================
// Runs one script against a sample message the way the pipeline would, without
// side effects: the script is compiled through the same compilers (a filter rule
// or transformer step exactly as deploy compiles it), sees the code templates
// for its context and the sample parsed with the channel's data type, and runs in
// the sandbox. Bridges that send, write or route (httpFetch, dbQuery,
// routeMessage, collection writes) throw instead of acting, and each skipped call
// is reported. Reads (getResource, collection find) work when the caller passes
// them. Nothing is stored.

import type { Result } from '@galvaniflow/core-util';
import { tryCatch } from '@galvaniflow/core-util';
import { templateDeclarations, type ScriptSurface, type TemplateSource } from '@galvaniflow/core-models';
import { compileScript, compileFilterRulesToScript, compileTransformerStepsToScript } from './script-compiler.js';
import { VmSandboxExecutor } from './sandbox-executor.js';
import { createSandboxContext, type SandboxContext } from './sandbox-context.js';
import type { BridgeDependencies, CollectionBridge } from './bridge-functions.js';
import { parseForSandbox, serializeFromSandbox } from '../pipeline/data-type-handler.js';
import { DestinationSet, createDestinationSetProxy } from '../pipeline/destination-set.js';

/** How the pipeline reads the script's result. */
export type ScriptTestKind = 'filter' | 'transformer' | 'script';

/** Read-only bridges a test run may use. */
export interface ScriptTestReaders {
  readonly getResource?: BridgeDependencies['getResource'];
  readonly collectionFind?: CollectionBridge['find'];
}

export interface ScriptTestInput {
  readonly script: string;
  readonly kind: ScriptTestKind;
  /** The script's surface; its data type parses the sample. Omit dataType for scripts with no message. */
  readonly surface: ScriptSurface;
  readonly templates: readonly TemplateSource[];
  readonly sample: string;
  /** The channel's destinations, for destinationSet in source scripts. */
  readonly destinations?: ReadonlyArray<{ readonly name: string; readonly metaDataId: number }>;
  readonly timeoutMs: number;
  readonly readers?: ScriptTestReaders;
}

/** What a test run reports. Script failures are an outcome, not an error. */
export interface ScriptTestResult {
  /** filter: accepted/filtered; transformer and script: completed; any failure: error. */
  readonly outcome: 'accepted' | 'filtered' | 'completed' | 'error';
  /** The message after a transformer or script, serialized as the pipeline would. */
  readonly output: string | null;
  /** What the script returned, as text (null when it returned nothing). */
  readonly returned: string | null;
  readonly logs: ReadonlyArray<{ readonly level: string; readonly message: string }>;
  /** Map entries the script set. */
  readonly maps: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Destinations the message would still go to (source scripts only). */
  readonly destinations: readonly string[] | null;
  /** Calls that would have had side effects and were not performed. */
  readonly skipped: readonly string[];
  readonly error: string | null;
  readonly durationMs: number;
}

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

/** Bridges that throw instead of acting, recording each call they refused. */
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

/** The script as the pipeline compiles it for this kind. */
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

/** Run a script against a sample message, with no side effects. */
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
    const result = await sandbox.execute(compiled.value, context, { timeout: input.timeoutMs });
    if (!result.ok) return errorResult(result.error.message, started, [], skipped);

    const { returnValue, msg, logs, mapUpdates } = result.value;
    const logLines = logs.map((l) => ({ level: l.level, message: l.message }));
    const filter = input.kind === 'filter';
    let output: string | null = null;
    if (!filter && dataType !== undefined) {
      const value = replacement(returnValue, msg);
      output = value == null ? null : serializeFromSandbox(value, dataType, input.sample);
    }
    return {
      outcome: filter ? (returnValue === true ? 'accepted' : 'filtered') : 'completed',
      output,
      returned: asText(returnValue),
      logs: logLines,
      maps: Object.fromEntries(Object.entries(mapUpdates).filter(([, entries]) => Object.keys(entries).length > 0)),
      destinations: destSet ? [...destSet.getConnectorNames()] : null,
      skipped,
      error: null,
      durationMs: Date.now() - started,
    };
  });
}
