// Runs scripts that can hang or abort the process that runs them, so it is only ever started as
// a child process with a deadline (hostile-run.ts). Prints one JSON line per script.

import { VmSandboxExecutor } from '../../sandbox-executor.js';
import { createSandboxContext } from '../../sandbox-context.js';
import { runScriptTestIsolated } from '../../script-test-isolated.js';

export interface HostileCase {
  readonly name: string;
  readonly script: string;
  readonly timeout: number;
  readonly template?: string;
  /** Wait for what the script left behind to run (garbage collection, V8 tasks, Node's rejection handling) before its outcome is printed. */
  readonly aftermath?: boolean;
}

export interface HostileRun {
  readonly mode: 'sync' | 'async' | 'isolated';
  readonly cases: readonly HostileCase[];
}

export interface HostileOutcome {
  readonly name: string;
  /** Null when the script finished without an error. */
  readonly error: string | null;
  readonly returned: unknown;
}

type Ran = Omit<HostileOutcome, 'name'>;

const AFTERMATH_STEP_MS = 50;
const LONGEST_TIMEOUT = 8_000;

async function isolated(c: HostileCase): Promise<Ran> {
  const templates = c.template === undefined
    ? []
    : [{ code: c.template, type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'] }];
  const result = await runScriptTestIsolated(
    { script: c.script, kind: 'script', sample: 'x', templates, surface: { templateContext: 'SOURCE_FILTER_TRANSFORMER' } },
    {},
    { timeoutMs: c.timeout, maxOldGenerationSizeMb: 64, maxMemoryGrowthMb: 512 },
  );
  return { error: result.error, returned: result.returned };
}

interface Attempt { readonly begun: boolean; readonly ran: Ran }

async function attempt(c: HostileCase, async: boolean, timeout: number): Promise<Attempt> {
  const executor = new VmSandboxExecutor(async ? { getResource: async () => 'r' } : undefined);
  let begun = false;
  const context = { ...createSandboxContext({}, ''), extras: { destinationSet: { removeAll: (): void => { begun = true; } } } };
  const result = await executor.execute({ code: `destinationSet.removeAll(); ${c.script}` }, context, { timeout });
  if (result.ok) return { begun, ran: { error: null, returned: result.value.returnValue } };
  // As if it had run with the case's own limit; a message that names any other time stays as it is.
  const error = result.error.message.replace(`after ${String(timeout)}ms`, `after ${String(c.timeout)}ms`);
  return { begun, ran: { error: begun ? error : `the script never began: ${error}`, returned: null } };
}

/**
 * Building the globals has the script's limit and the same message, and on a busy machine it reaches
 * a short one. A case that never began has shown nothing, so it runs again with twice the limit.
 */
async function inProcess(c: HostileCase, async: boolean): Promise<Ran> {
  let timeout = c.timeout;
  let last = await attempt(c, async, timeout);
  while (!last.begun && timeout < LONGEST_TIMEOUT) {
    timeout *= 2;
    last = await attempt(c, async, timeout);
  }
  return last.ran;
}

const pause = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, AFTERMATH_STEP_MS); });

async function aftermath(): Promise<void> {
  if (globalThis.gc === undefined) throw new Error('the child needs --expose-gc');
  await pause();
  globalThis.gc();
  await pause();
}

// As in the server: a rejection nothing handled is survived, an uncaught exception is not.
process.on('unhandledRejection', () => {});

const run = JSON.parse(process.argv[2] ?? '') as HostileRun;
for (const c of run.cases) {
  const ran = run.mode === 'isolated' ? await isolated(c) : await inProcess(c, run.mode === 'async');
  if (c.aftermath === true) await aftermath();
  const outcome: HostileOutcome = { name: c.name, ...ran };
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
