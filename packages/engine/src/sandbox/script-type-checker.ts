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
/**
 * Checks that may wait for the worker. Each is a deploy or a save; past this
 * many, a new one is refused at once rather than waiting behind all of them
 * and timing out, and the queue cannot grow without end (#228).
 */
export const TYPE_CHECK_QUEUE_LIMIT = 100;
/** Heap limit of the type-check worker. */
const TYPE_CHECK_HEAP_MB = 512;

/** A request waiting its turn. */
interface Queued {
  readonly request: TypeCheckRequest;
  readonly timeoutMs: number;
  readonly resolve: (reply: TypeCheckReply) => void;
}

/** The one request the worker is working on. */
interface InFlight {
  readonly queued: Queued;
  readonly worker: Worker;
  readonly timer: ReturnType<typeof setTimeout>;
}

const cache = new Map<string, readonly ScriptTypeError[]>();
let worker: Worker | undefined;
let nextId = 0;
// The worker gets one request at a time, so a request's time limit counts only
// its own work, and a request that overruns or crashes the worker fails alone:
// the ones queued behind it go to a fresh worker (#183).
const queue: Queued[] = [];
let inFlight: InFlight | undefined;

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

/** Settle the request in flight, if `reply` is its answer, and send the next one. */
function finish(reply: TypeCheckReply): void {
  const current = inFlight;
  if (current?.queued.request.id !== reply.id) return;
  clearTimeout(current.timer);
  inFlight = undefined;
  current.queued.resolve(reply);
  sendNext();
}

/**
 * A worker failed or stopped: the request it was working on fails, and the
 * next one goes to a fresh worker. Nothing to do for a worker already replaced.
 */
function workerLost(target: Worker, error: string): void {
  if (worker === target) worker = undefined;
  if (inFlight?.worker === target) finish({ id: inFlight.queued.request.id, ok: false, error });
}

function sendNext(): void {
  if (inFlight) return;
  const next = queue.shift();
  if (!next) return;
  const target = getWorker();
  const { id } = next.request;
  const timer = setTimeout(() => {
    // A check that overran may be stuck: stop its worker; the next check gets a fresh one.
    // Settle it before stopping the worker, whose exit would otherwise report it as stopped.
    if (worker === target) worker = undefined;
    finish({ id, ok: false, error: `Type-checking took longer than ${String(next.timeoutMs)} ms and was stopped.` });
    void target.terminate();
  }, next.timeoutMs);
  inFlight = { queued: next, worker: target, timer };
  target.postMessage(next.request);
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
  started.on('message', (reply: TypeCheckReply) => { finish(reply); });
  started.on('error', (err) => { workerLost(started, `The type checker failed: ${err.message}`); });
  started.on('exit', () => { workerLost(started, 'The type checker stopped.'); });
  worker = started;
  return started;
}

function ask(jobs: readonly TypeCheckJob[], templates: readonly TemplateSource[], timeoutMs: number): Promise<TypeCheckReply> {
  nextId += 1;
  const request: TypeCheckRequest = { id: nextId, jobs, templates };
  if (queue.length >= TYPE_CHECK_QUEUE_LIMIT) {
    return Promise.resolve({
      id: request.id, ok: false,
      error: `The type checker is busy: ${String(queue.length)} checks are waiting. Try again shortly.`,
    });
  }
  return new Promise((resolve) => {
    queue.push({ request, timeoutMs, resolve });
    sendNext();
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
    // Read the hits now: while the misses wait for the worker, other checks can
    // evict them (#228). The answers come from these and the reply, not the cache.
    const results = keys.map((k) => cache.get(k));
    const misses = jobs.flatMap((job, i) => (results[i] === undefined ? [{ job, index: i }] : []));
    if (misses.length > 0) {
      const reply = await ask(misses.map((m) => m.job), templates, options.timeoutMs ?? TYPE_CHECK_TIMEOUT_MS);
      if (!reply.ok) throw new Error(reply.error);
      misses.forEach((m, i) => {
        const errors = reply.results[i]!;
        results[m.index] = errors;
        remember(keys[m.index]!, errors);
      });
    }
    return results.map((r) => r!);
  });
}

/** Stop the worker (tests, shutdown), failing every check not yet answered. The next check starts a new one. */
export async function stopTypeChecker(): Promise<void> {
  for (const queued of queue.splice(0)) queued.resolve({ id: queued.request.id, ok: false, error: 'The type checker stopped.' });
  const current = worker;
  worker = undefined;
  if (current) await current.terminate();
}
