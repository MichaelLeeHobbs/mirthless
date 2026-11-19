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

const { SLOW_ENTRY_MS, entries } = vi.hoisted(() => ({
  SLOW_ENTRY_MS: 60,
  entries: { settles: 0, collectTimeouts: [] as number[] },
}));

vi.mock('node:vm', async (importOriginal) => {
  const vm = await importOriginal<typeof VmModule>();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const runInContext = ((code: string, context: VmModule.Context, options?: VmModule.RunningCodeOptions | string) => {
    const timeout = typeof options === 'object' ? options.timeout : undefined;
    if (timeout !== undefined) Atomics.wait(pause, 0, 0, SLOW_ENTRY_MS);
    if (code === '__settle()') entries.settles += 1;
    if (code === '__collect()' && timeout !== undefined) entries.collectTimeouts.push(timeout);
    return vm.runInContext(code, context, options);
  }) as typeof vm.runInContext;
  return { ...vm, runInContext, default: { ...vm, runInContext } };
});

describe('VmSandboxExecutor on a busy host', () => {
  it('finishes a script whose many reads complete together, however slow each entry into the sandbox is', async () => {
    const getResource = vi.fn(async () => 'x');
    const executor = new VmSandboxExecutor({ getResource });
    // 200 entries of 60 ms each would be 12 s, past the limit.
    const script = "const all = await Promise.all(Array.from({ length: 200 }, () => getResource('codes'))); return all.length;";
    const result = await executor.execute({ code: script }, createSandboxContext('m', 'r'), { timeout: 10_000 });

    expect(result.ok ? result.value.returnValue : result.error.message).toBe(200);
    expect(getResource).toHaveBeenCalledTimes(200);
    // The 200 reads finished together, so one entry settled them all.
    expect(entries.settles).toBe(1);
  });

  it('gives reading the result back a whole limit of its own, even when the host gets to it after the deadline (#188)', async () => {
    // The script's last act moves the host clock far past the deadline, as a
    // host descheduled between the script's end and the collection would.
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    entries.collectTimeouts.length = 0;
    try {
      const context = { ...createSandboxContext('m', 'r'), extras: { destinationSet: { removeAll: () => { skew = 60_000; } } } };
      const result = await new VmSandboxExecutor().execute({ code: "destinationSet.removeAll(); return 'done';" }, context, { timeout: 10_000 });

      expect(result.ok ? result.value.returnValue : result.error.message).toBe('done');
      // About the whole limit (the clock may tick between reading it and starting the call):
      // not what the script had left (nothing), nor a few milliseconds a busy host could use up.
      expect(entries.collectTimeouts).toHaveLength(1);
      expect(entries.collectTimeouts[0]).toBeGreaterThan(9_000);
    } finally {
      clock.mockRestore();
    }
  });
});
