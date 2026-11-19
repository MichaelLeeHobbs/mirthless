import { describe, it, expect, afterAll, vi } from 'vitest';
import { checkScriptTypesBatch, stopTypeChecker } from '../script-type-checker.js';
import { checkScriptTypes } from '../script-type-check.js';

vi.setConfig({ testTimeout: 60_000 });
afterAll(async () => { await stopTypeChecker(); });

const HL7 = { dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;

describe('checkScriptTypesBatch', () => {
  it('reports the same errors as checking each script directly', async () => {
    const jobs = [
      { code: "const n: number = '1';", surface: HL7 },
      { code: "logger.info(msg.get('PID.3.1'));", surface: HL7 },
    ];
    const batch = await checkScriptTypesBatch(jobs, []);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    const direct = await Promise.all(jobs.map((j) => checkScriptTypes(j.code, j.surface, [])));
    expect(batch.value).toEqual(direct.map((d) => (d.ok ? d.value : null)));
    expect(batch.value[0]![0]?.message).toContain("Type 'string' is not assignable to type 'number'");
    expect(batch.value[1]).toEqual([]);
  });

  it('answers a repeated check from its cache', async () => {
    const job = { code: "const s: string = 1; // cache me", surface: HL7 };
    const first = await checkScriptTypesBatch([job], []);
    const second = await checkScriptTypesBatch([job], []);
    if (!first.ok || !second.ok) throw new Error('check failed');
    // The very same array comes back: the second call never reached the worker.
    expect(second.value[0]).toBe(first.value[0]);
  });

  it('gives up after its time limit, and the next check still works', async () => {
    // A cold worker loads TypeScript first (hundreds of ms), so 1 ms is sure to run out;
    // a warm one can answer a tiny script before the timer gets its turn.
    await stopTypeChecker();
    const slow = await checkScriptTypesBatch([{ code: 'const x = 1; // not cached', surface: HL7 }], [], { timeoutMs: 1 });
    expect(slow.ok).toBe(false);
    if (!slow.ok) expect(slow.error.message).toMatch(/took longer than 1 ms/);
    const next = await checkScriptTypesBatch([{ code: 'const y = 2;', surface: HL7 }], []);
    expect(next.ok).toBe(true);
  });
});
