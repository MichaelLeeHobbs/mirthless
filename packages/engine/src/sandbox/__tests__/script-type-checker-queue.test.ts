// #183: checks share one worker, faked so a test decides when it answers, overruns or crashes.

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TypeCheckReply, TypeCheckRequest } from '../script-type-checker.js';

class FakeWorker extends EventEmitter {
  static readonly instances: FakeWorker[] = [];
  readonly posted: TypeCheckRequest[] = [];
  terminated = false;
  constructor() { super(); FakeWorker.instances.push(this); }
  postMessage(request: TypeCheckRequest): void { this.posted.push(request); }
  unref(): void {}
  async terminate(): Promise<number> {
    this.terminated = true;
    this.emit('exit', 1);
    return 1;
  }
  answer(index = 0): void {
    const request = this.posted[index]!;
    this.emit('message', { id: request.id, ok: true, results: request.jobs.map(() => []) } satisfies TypeCheckReply);
  }
}

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

const { checkScriptTypesBatch, stopTypeChecker, TYPE_CHECK_QUEUE_LIMIT } = await import('../script-type-checker.js');

const HL7 = { dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;
let n = 0;
/** A job no earlier test has cached. */
function freshJob(): { code: string; surface: typeof HL7 } {
  n += 1;
  return { code: `const v${String(n)} = ${String(n)};`, surface: HL7 };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  vi.useRealTimers();
  await stopTypeChecker();
  FakeWorker.instances.length = 0;
});

describe('checkScriptTypesBatch queueing', () => {
  it('sends one check at a time', async () => {
    const first = checkScriptTypesBatch([freshJob()], []);
    const second = checkScriptTypesBatch([freshJob()], []);
    const w = FakeWorker.instances[0]!;
    expect(w.posted).toHaveLength(1);
    w.answer(0);
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(w.posted).toHaveLength(2);
    w.answer(1);
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  it('starts a check\'s time limit when the worker takes it, not while it waits', async () => {
    const first = checkScriptTypesBatch([freshJob()], [], { timeoutMs: 10_000 });
    const second = checkScriptTypesBatch([freshJob()], [], { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(5_000);
    const w = FakeWorker.instances[0]!;
    w.answer(0);
    await expect(first).resolves.toMatchObject({ ok: true });
    w.answer(1);
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  it('fails only the check that overran; the next runs on a fresh worker', async () => {
    const slow = checkScriptTypesBatch([freshJob()], [], { timeoutMs: 100 });
    const queued = checkScriptTypesBatch([freshJob()], []);
    await vi.advanceTimersByTimeAsync(100);
    const result = await slow;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/^Type-checking took longer than 100 ms/);
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    const fresh = FakeWorker.instances[1]!;
    expect(fresh.posted).toHaveLength(1);
    fresh.answer(0);
    await expect(queued).resolves.toMatchObject({ ok: true });
  });

  it('fails only the check in flight when the worker crashes; the queued ones run on a fresh worker', async () => {
    const crashing = checkScriptTypesBatch([freshJob()], []);
    const queued = checkScriptTypesBatch([freshJob()], []);
    const w = FakeWorker.instances[0]!;
    w.emit('error', new Error('out of memory'));
    w.emit('exit', 1);
    const result = await crashing;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('The type checker failed: out of memory');
    const fresh = FakeWorker.instances[1]!;
    expect(fresh.posted).toHaveLength(1);
    fresh.answer(0);
    await expect(queued).resolves.toMatchObject({ ok: true });
  });

  it('ignores a late answer from a worker it already replaced', async () => {
    const slow = checkScriptTypesBatch([freshJob()], [], { timeoutMs: 100 });
    const queued = checkScriptTypesBatch([freshJob()], []);
    await vi.advanceTimersByTimeAsync(100);
    await slow;
    FakeWorker.instances[0]!.answer(0);
    FakeWorker.instances[1]!.emit('error', new Error('boom'));
    const result = await queued;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('The type checker failed: boom');
  });

  // #228: cache hits were read back after the misses were answered, when they could be evicted.
  it('answers a cached script even when it is evicted while the batch waits', async () => {
    const cached = freshJob();
    const prime = checkScriptTypesBatch([cached], []);
    FakeWorker.instances[0]!.answer(0);
    await prime;
    // A batch large enough to evict every older entry runs first; ours waits behind it.
    const flood = checkScriptTypesBatch(Array.from({ length: 500 }, freshJob), []);
    const ours = checkScriptTypesBatch([cached, freshJob()], []);
    const w = FakeWorker.instances[0]!;
    w.answer(1);
    await flood;
    w.answer(2);
    expect(await ours).toMatchObject({ ok: true, value: [[], []] });
  });

  it('answers every job of a batch larger than the cache', async () => {
    const big = checkScriptTypesBatch(Array.from({ length: 501 }, freshJob), []);
    FakeWorker.instances[0]!.answer(0);
    const result = await big;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.every((errors) => Array.isArray(errors))).toBe(true);
  });

  it('refuses a check when too many are already waiting, instead of queueing without end', async () => {
    const inFlight = checkScriptTypesBatch([freshJob()], []);
    const waiting = Array.from({ length: TYPE_CHECK_QUEUE_LIMIT }, () => checkScriptTypesBatch([freshJob()], []));
    const refused = await checkScriptTypesBatch([freshJob()], []);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe(`The type checker is busy: ${String(TYPE_CHECK_QUEUE_LIMIT)} checks are waiting.`);
    await stopTypeChecker();
    await Promise.all([inFlight, ...waiting]);
  });

  it('fails the queued checks when stopped', async () => {
    const inFlight = checkScriptTypesBatch([freshJob()], []);
    const queued = checkScriptTypesBatch([freshJob()], []);
    await stopTypeChecker();
    for (const r of await Promise.all([inFlight, queued])) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toBe('The type checker stopped.');
    }
    expect(FakeWorker.instances).toHaveLength(1);
  });
});
