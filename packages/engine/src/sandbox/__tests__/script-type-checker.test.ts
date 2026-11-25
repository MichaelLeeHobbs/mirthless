import { describe, it, expect, afterAll } from 'vitest';
import { checkScriptTypesBatch, stopTypeChecker } from '../script-type-checker.js';
import { checkScriptTypes } from '../script-type-check.js';

afterAll(async () => { await stopTypeChecker(); });

// Longer than the product's: from source, the worker also loads tsx and compiles what it imports (D-369).
const CHECK = { timeoutMs: 60_000 } as const;

const HL7 = { dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;

describe('checkScriptTypesBatch', () => {
  it('reports the same errors as checking each script directly', async () => {
    const jobs = [
      { code: "const n: number = '1';", surface: HL7 },
      { code: "logger.info(msg.get('PID.3.1'));", surface: HL7 },
    ];
    const batch = await checkScriptTypesBatch(jobs, [], CHECK);
    if (!batch.ok) throw batch.error;
    const direct = await Promise.all(jobs.map((j) => checkScriptTypes(j.code, j.surface, [])));
    expect(batch.value).toEqual(direct.map((d) => (d.ok ? d.value : null)));
    expect(batch.value[0]![0]?.message).toContain("Type 'string' is not assignable to type 'number'");
    expect(batch.value[1]).toEqual([]);
  });

  it('answers a repeated check from its cache', async () => {
    const job = { code: "const s: string = 1; // cache me", surface: HL7 };
    const first = await checkScriptTypesBatch([job], [], CHECK);
    const second = await checkScriptTypesBatch([job], [], CHECK);
    if (!first.ok) throw first.error;
    if (!second.ok) throw second.error;
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
    const next = await checkScriptTypesBatch([{ code: 'const y = 2;', surface: HL7 }], [], CHECK);
    if (!next.ok) throw next.error;
  });
});
