// A test run executes user code on demand, so it runs in a worker thread: an
// endless loop or a memory blow-up must cost the worker, never the engine's
// main thread (listeners, queues and the API share it).

import { describe, it, expect, vi } from 'vitest';
import { runScriptTestIsolated, type IsolatedTestInput } from '../script-test-isolated.js';
import type { ScriptTestResult } from '../script-test-run.js';

vi.setConfig({ testTimeout: 30_000 });

const ADT = ['MSH|^~\\&|EPIC|HOSP|GF|HOSP|20261115093000||ADT^A01|MSG1|P|2.5.1', 'PID|1||4821193^^^HOSP^MR||NGUYEN^AVERY'].join('\r');

async function run(overrides: Partial<IsolatedTestInput>, readers = {}): Promise<ScriptTestResult> {
  return runScriptTestIsolated(
    {
      script: 'return true;', kind: 'filter', sample: ADT, templates: [],
      surface: { dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER' },
      ...overrides,
    },
    readers,
    { timeoutMs: 1_000, maxOldGenerationSizeMb: 32 },
  );
}

describe('runScriptTestIsolated', () => {
  it('returns the same result as a test run on the main thread', async () => {
    const result = await run({ kind: 'transformer', script: "msg.set('PID.5.1', 'SMITH'); logger.info('done');" });
    expect(result.outcome).toBe('completed');
    expect(result.output?.split('\r')[1]).toBe('PID|1||4821193^^^HOSP^MR||SMITH^AVERY');
    expect(result.logs).toEqual([{ level: 'INFO', message: 'done' }]);
  });

  it('stops an endless loop without blocking the main thread', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 50);
    const result = await run({ kind: 'script', script: 'while (true) {}' });
    clearInterval(timer);
    expect(result.outcome).toBe('error');
    // The sandbox's own timeout usually stops it inside the worker; the worker is killed if not.
    expect(result.error).toMatch(/timed out after 1000 ?ms|stopped after 1000 ms/);
    // The loop ran for about a second; the main thread kept running meanwhile.
    expect(ticks).toBeGreaterThan(5);
  });

  it('reports a script that runs out of memory as an error, and the process lives on', async () => {
    const result = await run({ kind: 'script', script: 'const a = []; while (true) { a.push(new Array(1e5).fill(1)); }' }, {});
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/ran out of memory|stopped after/);
  });

  it('answers the script\'s reads with the caller\'s readers, on the main thread', async () => {
    const getResource = vi.fn(async (name: string) => `table:${name}`);
    const result = await run({ kind: 'script', script: "logger.info(await getResource('codes'));" }, { getResource });
    expect(getResource).toHaveBeenCalledWith('codes');
    expect(result.logs).toEqual([{ level: 'INFO', message: 'table:codes' }]);
  });

  it("passes a reader's failure back to the script as an error it can catch", async () => {
    const getResource = vi.fn(async () => { throw new Error('resource store is down'); });
    const result = await run({ kind: 'script', script: "try { await getResource('codes'); } catch (e) { logger.info('caught: ' + (e as Error).message); }" }, { getResource });
    expect(result.outcome).toBe('completed');
    expect(result.logs).toEqual([{ level: 'INFO', message: 'caught: resource store is down' }]);
  });

  it('refuses a read the caller did not provide, as a main-thread test run does', async () => {
    const result = await run({ kind: 'script', script: "await getResource('codes');" });
    expect(result.outcome).toBe('error');
    expect(result.skipped).toEqual(['getResource "codes"']);
  });
});
