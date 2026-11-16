// ===========================================
// Sandbox on a busy host
// ===========================================
// Node starts and joins a watchdog thread for every vm call that has a time
// limit. On a busy machine each one waits to be scheduled, so a timed entry into
// the sandbox costs milliseconds instead of microseconds. A run that entered the
// sandbox once per completed read spent its whole time limit on those entries
// and never finished (#188). Here every timed entry is made slow on purpose, the
// way a loaded machine makes it.

import { describe, it, expect, vi } from 'vitest';
import type * as VmModule from 'node:vm';
import { VmSandboxExecutor } from '../sandbox-executor.js';
import { createSandboxContext } from '../sandbox-context.js';

const { SLOW_ENTRY_MS, settles } = vi.hoisted(() => ({ SLOW_ENTRY_MS: 20, settles: { count: 0 } }));

vi.mock('node:vm', async (importOriginal) => {
  const vm = await importOriginal<typeof VmModule>();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const runInContext = ((code: string, context: VmModule.Context, options?: VmModule.RunningCodeOptions | string) => {
    if (typeof options === 'object' && options.timeout !== undefined) Atomics.wait(pause, 0, 0, SLOW_ENTRY_MS);
    if (code === '__settle()') settles.count += 1;
    return vm.runInContext(code, context, options);
  }) as typeof vm.runInContext;
  return { ...vm, runInContext, default: { ...vm, runInContext } };
});

describe('VmSandboxExecutor on a busy host', () => {
  it('finishes a script whose many reads complete together, however slow each entry into the sandbox is', async () => {
    const getResource = vi.fn(async () => 'x');
    const executor = new VmSandboxExecutor({ getResource });
    // 200 entries of 20 ms each would be 4 s, twice the limit.
    const script = "const all = await Promise.all(Array.from({ length: 200 }, () => getResource('codes'))); return all.length;";
    const result = await executor.execute({ code: script }, createSandboxContext('m', 'r'), { timeout: 2_000 });

    expect(result.ok ? result.value.returnValue : result.error.message).toBe(200);
    expect(getResource).toHaveBeenCalledTimes(200);
    // The 200 reads finished together, so one entry settled them all.
    expect(settles.count).toBe(1);
  });
});
