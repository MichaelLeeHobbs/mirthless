// Building a TypeScript program is hundreds of milliseconds of synchronous work for the first
// script and tens after; on the main thread a deploy's checks would stall listeners, queues and
// the API. So checks run in one long-lived worker, and results are cached by everything that
// decides them: the script, its surface's declarations and the code templates it can see.

import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { Result } from '@galvanigraph/core-util';
import { tryCatch } from '@galvanigraph/core-util';
import { scriptDeclarations, templateDeclarations, type ScriptSurface, type TemplateSource } from '@galvanigraph/core-models';
import type { ScriptTypeError } from './script-type-check.js';
import { workerEntry } from './worker-entry.js';

export interface TypeCheckJob {
  readonly code: string;
  readonly surface: ScriptSurface;
}

export interface TypeCheckRequest {
  readonly id: number;
  readonly jobs: readonly TypeCheckJob[];
  readonly templates: readonly TemplateSource[];
}

export type TypeCheckReply =
  | { readonly id: number; readonly ok: true; readonly results: ReadonlyArray<readonly ScriptTypeError[]> }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** Generous: a cold worker loads TypeScript first. */
export const TYPE_CHECK_TIMEOUT_MS = 30_000;
const CACHE_LIMIT = 500;
/**
 * Past this many waiting, a new check is refused at once (the server answers 503) so the queue
 * cannot grow without end (#228). It bounds how many wait, not how long.
 */
export const TYPE_CHECK_QUEUE_LIMIT = 100;
const TYPE_CHECK_HEAP_MB = 512;

interface Queued {
  readonly request: TypeCheckRequest;
  readonly timeoutMs: number;
  readonly resolve: (reply: TypeCheckReply) => void;
}

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

/** Ignores a reply that is not for the request in flight. */
function finish(reply: TypeCheckReply): void {
  const current = inFlight;
  if (current?.queued.request.id !== reply.id) return;
  clearTimeout(current.timer);
  inFlight = undefined;
  current.queued.resolve(reply);
  sendNext();
}

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
      error: `The type checker is busy: ${String(queue.length)} checks are waiting.`,
    });
  }
  return new Promise((resolve) => {
    queue.push({ request, timeoutMs, resolve });
    sendNext();
  });
}

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

/** Fails every check not yet answered; the next check starts a new worker. */
export async function stopTypeChecker(): Promise<void> {
  for (const queued of queue.splice(0)) queued.resolve({ id: queued.request.id, ok: false, error: 'The type checker stopped.' });
  const current = worker;
  worker = undefined;
  if (current) await current.terminate();
}
