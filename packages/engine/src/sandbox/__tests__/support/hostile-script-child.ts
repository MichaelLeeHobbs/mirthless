// Runs scripts that can hang or abort the process that runs them, so it is only ever started as
// a child process with a deadline (hostile-error-properties.test.ts). Prints one JSON line per script.

import { VmSandboxExecutor } from '../../sandbox-executor.js';
import { createSandboxContext } from '../../sandbox-context.js';
import { runScriptTestIsolated } from '../../script-test-isolated.js';

export interface HostileCase {
  readonly name: string;
  readonly script: string;
  readonly timeout: number;
  readonly template?: string;
}

export interface HostileRun {
  readonly mode: 'sync' | 'async' | 'isolated';
  readonly cases: readonly HostileCase[];
}

export interface HostileOutcome {
  readonly name: string;
  /** Null when the script finished without an error. */
  readonly error: string | null;
}

async function isolated(c: HostileCase): Promise<string | null> {
  const templates = c.template === undefined
    ? []
    : [{ code: c.template, type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'] }];
  const result = await runScriptTestIsolated(
    { script: c.script, kind: 'script', sample: 'x', templates, surface: { templateContext: 'SOURCE_FILTER_TRANSFORMER' } },
    {},
    { timeoutMs: c.timeout, maxOldGenerationSizeMb: 64, maxMemoryGrowthMb: 512 },
  );
  return result.error;
}

async function inProcess(c: HostileCase, async: boolean): Promise<string | null> {
  const executor = new VmSandboxExecutor(async ? { getResource: async () => 'r' } : undefined);
  const result = await executor.execute({ code: c.script }, createSandboxContext({}, ''), { timeout: c.timeout });
  return result.ok ? null : result.error.message;
}

const run = JSON.parse(process.argv[2] ?? '') as HostileRun;
for (const c of run.cases) {
  const error = run.mode === 'isolated' ? await isolated(c) : await inProcess(c, run.mode === 'async');
  const outcome: HostileOutcome = { name: c.name, error };
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
