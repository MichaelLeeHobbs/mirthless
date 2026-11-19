// In the main thread an endless loop would stop every listener, queue and API request until
// the timeout, and an allocation loop would crash the process (node:vm has no memory limit),
// so a test run happens in a worker with a heap limit that is terminated when its time is up.

import { Worker } from 'node:worker_threads';
import type { ScriptTestInput, ScriptTestReaders, ScriptTestResult } from './script-test-run.js';
import { workerEntry } from './worker-entry.js';

export type IsolatedTestInput = Omit<ScriptTestInput, 'readers' | 'timeoutMs' | 'onCompiled'>;

export interface IsolationLimits {
  /** The worker's start-up is not counted: it has WORKER_START_LIMIT_MS of its own. */
  readonly timeoutMs: number;
  readonly maxOldGenerationSizeMb: number;
  /**
   * Growth of the process's resident memory. The heap limit does not count ArrayBuffer memory,
   * which a script can allocate without bound, so the main thread terminates the worker past this.
   */
  readonly maxMemoryGrowthMb: number;
}

/** Each read (getResource, collection find) is a database query. */
export const MAX_TEST_READS = 100;
const MEMORY_SAMPLE_MS = 20;
/**
 * Start-up (modules, sample parse, compile) is the engine's cost, not the script's, and on a
 * busy machine takes seconds (esbuild starts a process of its own), so it is not charged to
 * the script's limit (#188).
 */
export const WORKER_START_LIMIT_MS = 30_000;
/**
 * Past the script's limit and the result-collecting limit of the same length (D-323). Covers
 * building the sandbox's globals, counted against neither, and a script the sandbox fails to stop.
 */
const STOP_GRACE_MS = 5_000;

export interface WorkerStart {
  readonly input: ScriptTestInput;
  readonly readers: ReadonlyArray<'getResource' | 'collectionFind'>;
}

/** `started`: the script is compiled and about to run. */
export type WorkerRequest =
  | { readonly type: 'started' }
  | { readonly type: 'read'; readonly id: number; readonly call: 'getResource' | 'collectionFind'; readonly args: readonly unknown[] }
  | { readonly type: 'done'; readonly result: ScriptTestResult }
  | { readonly type: 'failed'; readonly error: string };

export type WorkerReply =
  | { readonly type: 'read-result'; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly type: 'read-result'; readonly id: number; readonly ok: false; readonly error: string };

export function tooManyReads(): string {
  return `A test run may read at most ${String(MAX_TEST_READS)} times (getResource, collection find).`;
}

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

/** Never rejects: a timeout, an out-of-memory crash or any other failure is an `error` outcome. */
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
    let memoryWatch: ReturnType<typeof setInterval> | undefined;
    const worker = new Worker(entry.url, {
      workerData: start,
      execArgv: entry.execArgv,
      // Runs user code: none of the server's environment (database URL, JWT secret).
      env: entry.env,
      resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 16 },
    });
    const onMessage = (message: WorkerRequest): void => {
      // A terminated worker's queued messages are dropped, not answered.
      if (settled) return;
      if (message.type === 'started') {
        clearTimeout(timer);
        timer = setTimeout(() => { fail(`The script was stopped after ${String(limits.timeoutMs)} ms.`); }, 2 * limits.timeoutMs + STOP_GRACE_MS);
        watchMemory();
      } else if (message.type === 'read') {
        // The worker refuses reads past MAX_TEST_READS before asking; the script
        // cannot reach the worker's port from inside the sandbox.
        void answer(readers, message).then((reply) => { if (!settled) worker.postMessage(reply); });
      } else if (message.type === 'done') {
        finish(message.result);
      } else {
        fail(`The test run failed: ${message.error}`);
      }
    };
    const finish = (result: ScriptTestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(memoryWatch);
      worker.off('message', onMessage);
      void worker.terminate();
      resolve(result);
    };
    const fail = (text: string): void => { finish(errorResult(text, Date.now() - started)); };
    // Until the worker says it has started, only the start-up limit runs.
    let timer = setTimeout(() => {
      fail(`The test run could not start within ${String(WORKER_START_LIMIT_MS / 1000)} s. The server may be busy; try again.`);
    }, WORKER_START_LIMIT_MS);
    // Baseline once the worker has started, so its own start-up is not counted.
    const watchMemory = (): void => {
      const baseline = process.memoryUsage.rss();
      const limit = limits.maxMemoryGrowthMb * 1024 * 1024;
      memoryWatch = setInterval(() => {
        if (process.memoryUsage.rss() - baseline > limit) {
          fail(`The script used more than ${String(limits.maxMemoryGrowthMb)} MB of memory and was stopped.`);
        }
      }, MEMORY_SAMPLE_MS);
    };

    worker.on('message', onMessage);
    worker.on('error', (err: Error & { code?: string }) => {
      fail(err.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? `The script ran out of memory (the test-run limit is ${String(limits.maxOldGenerationSizeMb)} MB).`
        : `The test run failed: ${err.message}`);
    });
    worker.on('exit', (code) => { fail(`The test run ended unexpectedly (exit code ${String(code)}).`); });
  });
}
