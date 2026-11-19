// A script must never be able to block the host event loop: code that runs after
// an `await` (or in a promise callback) is bounded by the script timeout, and a
// timed-out script can never resume or keep calling IO bridges.

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect, vi } from 'vitest';
import { VmSandboxExecutor, type CompiledScript } from '../sandbox-executor.js';
import { createSandboxContext } from '../sandbox-context.js';

function makeScript(code: string): CompiledScript {
  return { code };
}

// For scripts that are meant to finish: generous, so a loaded machine cannot turn a pass into a timeout (#125).
const OPTIONS = { timeout: 10_000 };
// For scripts that are meant to be stopped by the limit.
const SHORT = { timeout: 100 };
// Long enough that setup and the 20ms bridge finish well before the limit on a loaded
// machine, so the loop after the bridge is what gets stopped. At 100ms, setup alone could
// use up the limit before the bridge was called.
const AFTER_BRIDGE = { timeout: 2_000 };

/**
 * Runs the work and reports whether the host event loop got a turn while it was pending.
 * The ticker is scheduled before the work starts, so its 5ms timer always
 * expires ahead of any longer timer the work schedules, however loaded the machine.
 */
async function runWatchingHost<T>(start: () => Promise<T>): Promise<{ readonly ticked: boolean; readonly result: T }> {
  let ticked = false;
  const timer = setInterval(() => { ticked = true; }, 5);
  const result = await start();
  clearInterval(timer);
  return { ticked, result };
}

describe('VmSandboxExecutor async isolation', () => {
  it('times out an infinite loop after a bare await instead of hanging the host', async () => {
    const executor = new VmSandboxExecutor({ getResource: vi.fn().mockResolvedValue('x') });
    const result = await executor.execute(makeScript('await 0; while (true) {}'), createSandboxContext('m', 'r'), SHORT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Script execution timed out after 100ms');
  });

  it('times out an infinite loop that runs after an IO bridge resolves', async () => {
    const getResource = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r('x'), 20)));
    const executor = new VmSandboxExecutor({ getResource });
    const { ticked, result } = await runWatchingHost(() =>
      executor.execute(makeScript('await getResource("a"); getResource("after"); while (true) {}'), createSandboxContext('m', 'r'), AFTER_BRIDGE));

    // The script got past the await, so the loop after the bridge is what the limit stopped.
    expect(getResource).toHaveBeenCalledWith('after');
    expect(ticked).toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Script execution timed out after 2000ms');
  });

  it("names the script's own time limit when the limit stops it between reads (#188)", async () => {
    // Each step after a read runs 30 ms, so the limit runs out inside one of them.
    // The error names the 300 ms limit, not the few milliseconds that step had left.
    const executor = new VmSandboxExecutor({ getResource: vi.fn().mockResolvedValue('x') });
    const script = "for (;;) { await getResource('a'); const t = Date.now(); while (Date.now() - t < 30) {} }";
    const result = await executor.execute(makeScript(script), createSandboxContext('m', 'r'), { timeout: 300 });

    expect(result.ok ? 'finished' : result.error.message).toBe('Script execution timed out after 300ms');
  });

  it('gives each of several reads that finish together its own result (#188)', async () => {
    const getResource = vi.fn(async (name: string) => `value of ${name}`);
    const executor = new VmSandboxExecutor({ getResource });
    const script = "return (await Promise.all(['a', 'b', 'c', 'd'].map((n) => getResource(n)))).join(', ');";
    const result = await executor.execute(makeScript(script), createSandboxContext('m', 'r'), OPTIONS);

    expect(result.ok ? result.value.returnValue : result.error.message).toBe('value of a, value of b, value of c, value of d');
  });

  it('times out an infinite loop inside a promise callback of a synchronous script', async () => {
    const executor = new VmSandboxExecutor();
    const result = await executor.execute(
      makeScript('Promise.resolve().then(function () { while (true) {} }); return 1;'),
      createSandboxContext('m', 'r'),
      SHORT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Script execution timed out after 100ms');
  });

  it('never resumes a timed-out script, so it cannot keep calling bridges', async () => {
    const getResource = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r('x'), 150)));
    const httpFetch = vi.fn();
    const executor = new VmSandboxExecutor({ getResource, httpFetch });
    const result = await executor.execute(
      makeScript('await getResource("slow"); await httpFetch("https://example.com"); return 1;'),
      createSandboxContext('m', 'r'),
      { timeout: 50 },
    );

    expect(result.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('still returns values from sequential awaited bridges', async () => {
    const getResource = vi.fn().mockImplementation((name: string) => Promise.resolve(`<${name}>`));
    const executor = new VmSandboxExecutor({ getResource });
    const result = await executor.execute(
      makeScript('var a = await getResource("a"); var b = await getResource("b"); return a + b;'),
      createSandboxContext('m', 'r'),
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.returnValue).toBe('<a><b>');
  });

  it('runs concurrent bridge calls with Promise.all', async () => {
    const getResource = vi.fn().mockImplementation((name: string) => new Promise((r) => setTimeout(() => r(name), 5)));
    const executor = new VmSandboxExecutor({ getResource });
    const result = await executor.execute(
      makeScript('var r = await Promise.all([getResource("a"), getResource("b")]); return r.join(",");'),
      createSandboxContext('m', 'r'),
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.returnValue).toBe('a,b');
  });

  it('surfaces an error thrown after an await', async () => {
    const executor = new VmSandboxExecutor({ getResource: vi.fn().mockResolvedValue('x') });
    const result = await executor.execute(
      makeScript('await getResource("a"); throw new Error("boom");'),
      createSandboxContext('m', 'r'),
      OPTIONS,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('boom');
  });

  it('keeps the caller\'s async context for bridge calls made after an await', async () => {
    // The engine's routeMessage loop guard relies on AsyncLocalStorage following
    // the message chain through the sandbox.
    const als = new AsyncLocalStorage<string>();
    const getResource = vi.fn(async () => als.getStore() ?? 'none');
    const executor = new VmSandboxExecutor({ getResource });
    const result = await als.run('chain-1', () => executor.execute(
      makeScript('var a = await getResource("a"); var b = await getResource("b"); return a + "," + b;'),
      createSandboxContext('m', 'r'),
      OPTIONS,
    ));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.returnValue).toBe('chain-1,chain-1');
  });
});
