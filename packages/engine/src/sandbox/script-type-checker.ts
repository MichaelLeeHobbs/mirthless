// ===========================================
// Script type checker
// ===========================================
// Type-checking a script builds a TypeScript program: hundreds of milliseconds
// of synchronous work for the first script, tens after that. Deploy checks
// every TypeScript script of a channel, so on the engine's main thread that
// would stall listeners, queues and the API. Checks run in one long-lived
// worker thread instead (TypeScript and its lib files load once), with a time
// limit per request, and results are cached by everything that decides them:
// the script, its surface's declarations and the code templates it can see.

import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { Result } from '@galvaniflow/core-util';
import { tryCatch } from '@galvaniflow/core-util';
import { scriptDeclarations, templateDeclarations, type ScriptSurface, type TemplateSource } from '@galvaniflow/core-models';
import type { ScriptTypeError } from './script-type-check.js';
import { workerEntry } from './worker-entry.js';

/** One script to check. */
export interface TypeCheckJob {
  readonly code: string;
  readonly surface: ScriptSurface;
}

/** Main thread to worker. */
export interface TypeCheckRequest {
  readonly id: number;
  readonly jobs: readonly TypeCheckJob[];
  readonly templates: readonly TemplateSource[];
}

/** Worker to main thread. */
export type TypeCheckReply =
  | { readonly id: number; readonly ok: true; readonly results: ReadonlyArray<readonly ScriptTypeError[]> }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** Default time limit for one batch: generous, since a cold worker loads TypeScript first. */
export const TYPE_CHECK_TIMEOUT_MS = 30_000;
const CACHE_LIMIT = 500;
/** Heap limit of the type-check worker. */
const TYPE_CHECK_HEAP_MB = 512;

const cache = new Map<string, readonly ScriptTypeError[]>();
let worker: Worker | undefined;
let nextId = 0;
/** Requests waiting for a reply, with the worker each was sent to. */
const pending = new Map<number, { readonly worker: Worker; readonly settle: (reply: TypeCheckReply) => void }>();

function cacheKey(job: TypeCheckJob, templates: readonly TemplateSource[]): string {
  return createHash('sha256')
    .update(job.code).update('\0')
    .update(scriptDeclarations(job.surface)).update('\0')
    .update(templateDeclarations(templates, job.surface))
    .digest('hex');
}

function remember(key: string, errors: readonly ScriptTypeError[]): void {
  cache.set(key, errors);
  // Oldest first: a Map iterates in insertion order.
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/** Fail the requests sent to one worker; requests already on its replacement are not its to fail. */
function failRequestsOf(target: Worker, error: string): void {
  for (const [id, entry] of pending) {
    if (entry.worker !== target) continue;
    pending.delete(id);
    entry.settle({ id, ok: false, error });
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const entry = workerEntry(import.meta.url, 'script-type-worker');
  const started = new Worker(entry.url, {
    execArgv: entry.execArgv,
    // It needs none of the server's environment (database URL, JWT secret).
    env: entry.env,
    // TypeScript with its lib files fits comfortably; a runaway check is stopped, not the engine.
    resourceLimits: { maxOldGenerationSizeMb: TYPE_CHECK_HEAP_MB },
  });
  // Idle checks must not keep the process alive.
  started.unref();
  started.on('message', (reply: TypeCheckReply) => {
    const entry = pending.get(reply.id);
    pending.delete(reply.id);
    entry?.settle(reply);
  });
  started.on('error', (err) => { failRequestsOf(started, `The type checker failed: ${err.message}`); });
  started.on('exit', () => {
    if (worker === started) worker = undefined;
    failRequestsOf(started, 'The type checker stopped.');
  });
  worker = started;
  return started;
}

function ask(jobs: readonly TypeCheckJob[], templates: readonly TemplateSource[], timeoutMs: number): Promise<TypeCheckReply> {
  nextId += 1;
  const id = nextId;
  const target = getWorker();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A check that overran may be stuck: start the next one on a fresh worker.
      if (worker === target) worker = undefined;
      void target.terminate();
      resolve({ id, ok: false, error: `Type-checking took longer than ${String(timeoutMs)} ms and was stopped.` });
    }, timeoutMs);
    pending.set(id, { worker: target, settle: (reply) => { clearTimeout(timer); resolve(reply); } });
    target.postMessage({ id, jobs, templates } satisfies TypeCheckRequest);
  });
}

/**
 * Type-check scripts off the main thread. Returns each job's errors, in order
 * (empty for a clean script); fails when the checker fails or overruns.
 */
export async function checkScriptTypesBatch(
  jobs: readonly TypeCheckJob[],
  templates: readonly TemplateSource[],
  options: { readonly timeoutMs?: number } = {},
): Promise<Result<ReadonlyArray<readonly ScriptTypeError[]>>> {
  return tryCatch(async () => {
    const keys = jobs.map((j) => cacheKey(j, templates));
    const misses = jobs.flatMap((job, i) => (cache.has(keys[i]!) ? [] : [{ job, key: keys[i]! }]));
    if (misses.length > 0) {
      const reply = await ask(misses.map((m) => m.job), templates, options.timeoutMs ?? TYPE_CHECK_TIMEOUT_MS);
      if (!reply.ok) throw new Error(reply.error);
      misses.forEach((m, i) => { remember(m.key, reply.results[i]!); });
    }
    return keys.map((k) => cache.get(k)!);
  });
}

/** Stop the worker (tests, shutdown). The next check starts a new one. */
export async function stopTypeChecker(): Promise<void> {
  const current = worker;
  worker = undefined;
  if (current) await current.terminate();
}
