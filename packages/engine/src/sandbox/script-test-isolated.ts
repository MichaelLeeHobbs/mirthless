// ===========================================
// Isolated script test run
// ===========================================
// A test run executes user code on demand (the editor's Run button). In the
// main thread an endless loop would stop every listener, queue and API request
// until the timeout, and an allocation loop would crash the process: node:vm has
// no memory limit. So the run happens in a worker thread with a heap limit, and
// the main thread terminates it when its time is up. Reads the script makes are
// answered on the main thread by the caller's readers.

import { Worker } from 'node:worker_threads';
import type { ScriptTestInput, ScriptTestReaders, ScriptTestResult } from './script-test-run.js';
import { workerEntry } from './worker-entry.js';

/** The test-run input that crosses into the worker: everything but the readers. */
export type IsolatedTestInput = Omit<ScriptTestInput, 'readers' | 'timeoutMs'>;

export interface IsolationLimits {
  /** Wall-clock time for the whole run; the worker is terminated after it. */
  readonly timeoutMs: number;
  /** Heap limit for the worker. */
  readonly maxOldGenerationSizeMb: number;
}

/** What the worker starts with. */
export interface WorkerStart {
  readonly input: ScriptTestInput;
  readonly readers: ReadonlyArray<'getResource' | 'collectionFind'>;
}

/** Worker to main thread. */
export type WorkerRequest =
  | { readonly type: 'read'; readonly id: number; readonly call: 'getResource' | 'collectionFind'; readonly args: readonly unknown[] }
  | { readonly type: 'done'; readonly result: ScriptTestResult }
  | { readonly type: 'failed'; readonly error: string };

/** Main thread to worker. */
export type WorkerReply =
  | { readonly type: 'read-result'; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly type: 'read-result'; readonly id: number; readonly ok: false; readonly error: string };

function errorResult(error: string, durationMs: number): ScriptTestResult {
  return { outcome: 'error', output: null, returned: null, logs: [], maps: {}, destinations: null, skipped: [], error, durationMs };
}

async function answer(readers: ScriptTestReaders, request: Extract<WorkerRequest, { type: 'read' }>): Promise<WorkerReply> {
  try {
    const value = request.call === 'getResource'
      ? await readers.getResource?.(request.args[0] as string)
      : await (readers.collectionFind as ((...a: unknown[]) => Promise<unknown>) | undefined)?.(...request.args);
    return { type: 'read-result', id: request.id, ok: true, value };
  } catch (err: unknown) {
    return { type: 'read-result', id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run a test run in a worker thread with a heap limit and a hard time limit.
 * Never rejects: a timeout, an out-of-memory crash or any failure of the run
 * itself comes back as an `error` outcome.
 */
export function runScriptTestIsolated(
  input: IsolatedTestInput, readers: ScriptTestReaders, limits: IsolationLimits,
): Promise<ScriptTestResult> {
  const started = Date.now();
  const entry = workerEntry(import.meta.url, 'script-test-worker');
  const offered = (['getResource', 'collectionFind'] as const).filter((k) => readers[k] !== undefined);
  // The sandbox's own timeout stops a loop inside the worker first; the
  // worker is terminated a little later in case it does not.
  const start: WorkerStart = { input: { ...input, timeoutMs: limits.timeoutMs }, readers: offered };

  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(entry.url, {
      workerData: start,
      execArgv: entry.execArgv,
      resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 16 },
    });
    const finish = (result: ScriptTestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const fail = (text: string): void => { finish(errorResult(text, Date.now() - started)); };
    const timer = setTimeout(() => { fail(`The script was stopped after ${String(limits.timeoutMs)} ms.`); }, limits.timeoutMs + 1_000);

    worker.on('message', (message: WorkerRequest) => {
      if (message.type === 'read') {
        void answer(readers, message).then((reply) => { if (!settled) worker.postMessage(reply); });
      } else if (message.type === 'done') {
        finish(message.result);
      } else {
        fail(`The test run failed: ${message.error}`);
      }
    });
    worker.on('error', (err: Error & { code?: string }) => {
      fail(err.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? `The script ran out of memory (the test-run limit is ${String(limits.maxOldGenerationSizeMb)} MB).`
        : `The test run failed: ${err.message}`);
    });
    worker.on('exit', (code) => { fail(`The test run ended unexpectedly (exit code ${String(code)}).`); });
  });
}
