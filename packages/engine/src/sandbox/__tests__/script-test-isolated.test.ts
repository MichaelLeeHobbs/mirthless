// A test run executes user code on demand, so it runs in a worker thread: an
// endless loop or a memory blow-up must cost the worker, never the engine's
// main thread (listeners, queues and the API share it).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runScriptTestIsolated, MAX_TEST_READS, WORKER_START_LIMIT_MS, tooManyReads, type IsolatedTestInput, type IsolationLimits,
} from '../script-test-isolated.js';
import { runScriptTest, type ScriptTestResult } from '../script-test-run.js';

vi.setConfig({ testTimeout: 30_000 });

const ADT = ['MSH|^~\\&|EPIC|HOSP|GF|HOSP|20261115093000||ADT^A01|MSG1|P|2.5.1', 'PID|1||4821193^^^HOSP^MR||NGUYEN^AVERY'].join('\r');

function inputOf(overrides: Partial<IsolatedTestInput>): IsolatedTestInput {
  return {
    script: 'return true;', kind: 'filter', sample: ADT, templates: [],
    surface: { dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER' },
    ...overrides,
  };
}

async function run(overrides: Partial<IsolatedTestInput>, readers = {}, limits: Partial<IsolationLimits> = {}): Promise<ScriptTestResult> {
  return runScriptTestIsolated(
    inputOf(overrides),
    readers,
    // Scripts meant to finish get a generous limit, so only the time-limit tests
    // depend on the clock (D-290, #188).
    { timeoutMs: 10_000, maxOldGenerationSizeMb: 32, maxMemoryGrowthMb: 256, ...limits },
  );
}

describe('runScriptTestIsolated', () => {
  it('returns the same result as a test run on the main thread', async () => {
    const input = { kind: 'transformer', script: "msg.set('PID.5.1', 'SMITH'); channelMap.seen = 1; logger.info('done');" } as const;
    const result = await run(input);
    const onMain = await runScriptTest({ ...inputOf(input), readers: {}, timeoutMs: 10_000 });

    expect(result.outcome).toBe('completed');
    expect(result.output?.split('\r')[1]).toBe('PID|1||4821193^^^HOSP^MR||SMITH^AVERY');
    expect({ ...result, durationMs: 0 }).toEqual({ ...onMain.value, durationMs: 0 });
  });

  it('stops an endless loop without blocking the main thread', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 50);
    const result = await run({ kind: 'script', script: 'while (true) {}' }, {}, { timeoutMs: 1_000 });
    clearInterval(timer);
    expect(result.outcome).toBe('error');
    // The sandbox's own words: the backstop that kills the worker 6 s later says "was stopped after 1000 ms".
    expect(result.error).toBe('Script execution timed out after 1000ms');
    // The loop ran for about a second; the main thread kept running meanwhile.
    expect(ticks).toBeGreaterThan(5);
  });

  describe('on a machine too busy to start the worker in time (#188)', () => {
    // Only the main thread's timeouts are faked; the worker's clock is real.
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
    afterEach(() => { vi.useRealTimers(); });

    it("does not count the worker's start-up against the script's time limit", async () => {
      const pending = run({ kind: 'transformer', script: "logger.info('done');" });
      // Far past the 10 s limit and its grace before the worker has even started.
      vi.advanceTimersByTime(25_000);
      const result = await pending;
      expect(result.error).toBeNull();
      expect(result.outcome).toBe('completed');
    });

    it('gives up on a worker that does not start at all, and says why', async () => {
      const pending = run({ kind: 'transformer', script: "logger.info('done');" });
      vi.advanceTimersByTime(WORKER_START_LIMIT_MS);
      const result = await pending;
      expect(result.outcome).toBe('error');
      expect(result.error).toBe(`The test run could not start within ${String(WORKER_START_LIMIT_MS / 1000)} s. The server may be busy; try again.`);
    });
  });

  it('reports a script that runs out of memory as an error, and the process lives on', async () => {
    // The time limit and the memory-growth cap are far off, so only the heap limit can stop it (#183).
    const result = await run(
      { kind: 'script', script: 'const a = []; while (true) { a.push(new Array(1e5).fill(1)); }' },
      {},
      { timeoutMs: 20_000, maxMemoryGrowthMb: 4_096 },
    );
    expect(result.outcome).toBe('error');
    expect(result.error).toBe('The script ran out of memory (the test-run limit is 32 MB).');
  });

  it('stops a script that fills memory outside the heap limit (typed arrays)', async () => {
    // ArrayBuffer memory is not counted by the worker's heap limit, so a script
    // could take the whole machine's memory and get the engine OOM-killed.
    const script = 'const keep = []; for (let i = 0; i < 6; i++) keep.push(new Uint8Array(64 * 1024 * 1024).fill(1)); logger.info(String(keep.length));';
    const result = await run({ kind: 'script', script }, {}, { timeoutMs: 10_000, maxMemoryGrowthMb: 64 });
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/more than 64 MB of memory/);
  });

  it('caps the reads one run may make, so a loop cannot flood the database', async () => {
    const getResource = vi.fn(async () => 'x');
    const script = [
      'const reads = [];',
      "for (let i = 0; i < 1000; i++) reads.push(getResource('codes'));",
      'const settled = await Promise.allSettled(reads);',
      "const refused = settled.filter((s) => s.status === 'rejected');",
      'logger.info(String(refused.length));',
      'logger.info((refused[0] as PromiseRejectedResult).reason.message);',
    ].join('\n');
    const result = await run({ kind: 'script', script }, { getResource });
    // First, so a run stopped by its time limit shows as a timeout, not as missing logs.
    expect(result.error).toBeNull();
    expect(result.outcome).toBe('completed');
    expect(getResource).toHaveBeenCalledTimes(MAX_TEST_READS);
    // The rest are refused in the worker, never reaching the main thread, and the script is told why.
    expect(result.logs).toEqual([
      { level: 'INFO', message: String(1000 - MAX_TEST_READS) },
      { level: 'INFO', message: tooManyReads() },
    ]);
  });

  it('answers the script\'s reads with the caller\'s readers, on the main thread', async () => {
    const getResource = vi.fn(async (name: string) => `table:${name}`);
    const result = await run({ kind: 'script', script: "logger.info(await getResource('codes'));" }, { getResource });
    expect(result.error).toBeNull();
    expect(result.outcome).toBe('completed');
    expect(getResource).toHaveBeenCalledWith('codes');
    expect(result.logs).toEqual([{ level: 'INFO', message: 'table:codes' }]);
  });

  it("passes a reader's failure back to the script as an error it can catch", async () => {
    const getResource = vi.fn(async () => { throw new Error('resource store is down'); });
    const result = await run({ kind: 'script', script: "try { await getResource('codes'); } catch (e) { logger.info('caught: ' + (e as Error).message); }" }, { getResource });
    expect(result.error).toBeNull();
    expect(result.outcome).toBe('completed');
    expect(result.logs).toEqual([{ level: 'INFO', message: 'caught: resource store is down' }]);
  });

  it('refuses a read the caller did not provide, as a main-thread test run does', async () => {
    const result = await run({ kind: 'script', script: "await getResource('codes');" });
    expect(result.outcome).toBe('error');
    expect(result.skipped).toEqual(['getResource "codes"']);
  });
});
