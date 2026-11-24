import { afterEach, describe, expect, it } from 'vitest';
import { VmSandboxExecutor } from '../sandbox-executor.js';
import { createSandboxContext } from '../sandbox-context.js';
import { beatScriptWatch, readScriptWatch, scriptWatchBuffer, StuckDetector, watchScript, type ScriptWatch } from '../script-watch.js';

const CHANNEL = 'b5a7c1de-0000-4000-8000-00000000000a';

const now = (): ScriptWatch => readScriptWatch(scriptWatchBuffer());

describe('watchScript', () => {
  it('shows the limit and the channel while the script runs, and nothing afterwards', () => {
    const during = watchScript(500, CHANNEL, now);
    expect(during).toMatchObject({ limitMs: 500, channelId: CHANNEL });
    expect(now()).toMatchObject({ limitMs: 0, channelId: null });
  });

  it('shows nothing after a script that throws', () => {
    expect(() => watchScript(500, CHANNEL, () => { throw new Error('boom'); })).toThrow('boom');
    expect(now()).toMatchObject({ limitMs: 0, channelId: null });
  });

  it('shows no channel for a script that has none, whatever ran before', () => {
    watchScript(500, CHANNEL, now);
    expect(watchScript(500, undefined, now)).toMatchObject({ limitMs: 500, channelId: null });
  });

  it('shows the whole of a shorter channel id after a longer one', () => {
    watchScript(500, CHANNEL, now);
    expect(watchScript(500, 'short', now).channelId).toBe('short');
  });

  it('shows nothing while a debugger is open: a script at a breakpoint is not stuck', () => {
    beatScriptWatch(true);
    expect(watchScript(500, CHANNEL, now)).toMatchObject({ limitMs: 0, channelId: null });
    beatScriptWatch(false);
    expect(watchScript(500, CHANNEL, now)).toMatchObject({ limitMs: 500, channelId: CHANNEL });
  });

  it('counts each script and each beat as a sign of life', () => {
    const before = now().sequence;
    watchScript(500, CHANNEL, now);
    const afterScript = now().sequence;
    beatScriptWatch(false);
    expect(afterScript).not.toBe(before);
    expect(now().sequence).not.toBe(afterScript);
  });
});

describe('VmSandboxExecutor under watch', () => {
  let seen: ScriptWatch[] = [];
  afterEach(() => { seen = []; });

  async function run(code: string, async: boolean): Promise<void> {
    const executor = new VmSandboxExecutor(async ? { getResource: async () => 'r' } : undefined);
    const context = { ...createSandboxContext({}, ''), extras: { destinationSet: { removeAll: (): void => { seen.push(now()); } } } };
    const result = await executor.execute({ code }, context, { timeout: 30_000, channelId: CHANNEL });
    expect(result.ok).toBe(true);
  }

  it('watches a synchronous script under its channel and its own limit', async () => {
    await run('destinationSet.removeAll();', false);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.channelId).toBe(CHANNEL);
    expect(seen[0]?.limitMs).toBeGreaterThan(0);
    expect(seen[0]?.limitMs).toBeLessThanOrEqual(30_000);
    expect(now().limitMs).toBe(0);
  });

  it('watches the part of a script that follows an await', async () => {
    await run('await getResource("x"); destinationSet.removeAll();', true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.channelId).toBe(CHANNEL);
    expect(now().limitMs).toBe(0);
  });

  it('watches reading the result, under the same channel', async () => {
    await run('return { toJSON() { destinationSet.removeAll(); return 1; } };', false);
    expect(seen.map((s) => s.channelId)).toContain(CHANNEL);
    expect(seen.map((s) => s.channelId)).not.toContain(null);
  });

  it('does not watch while the script waits for a bridge', async () => {
    let whileWaiting: ScriptWatch | undefined;
    const executor = new VmSandboxExecutor({ getResource: async () => { await new Promise((r) => { setImmediate(r); }); whileWaiting = now(); return 'r'; } });
    const result = await executor.execute({ code: 'return await getResource("x");' }, createSandboxContext({}, ''), { timeout: 30_000, channelId: CHANNEL });
    expect(result.ok).toBe(true);
    expect(whileWaiting).toMatchObject({ limitMs: 0, channelId: null });
  });
});

describe('StuckDetector', () => {
  const running = (sequence: number, limitMs = 1_000): ScriptWatch => ({ sequence, limitMs, channelId: CHANNEL });
  const detector = (): StuckDetector => new StuckDetector({ graceMs: 5_000, tickMs: 1_000 });

  /** Ticks the same reading every `elapsed` ms; the number of the first tick that says stuck, or null. */
  function firstStuck(d: StuckDetector, reading: ScriptWatch, ticks: number, elapsed = 1_000): number | null {
    for (let i = 1; i <= ticks; i += 1) if (d.tick(reading, elapsed)) return i;
    return null;
  }

  it('says stuck only past the limit and the grace together', () => {
    // The first reading starts the count at 0; 6 s more is not past 1 s + 5 s, 7 s is.
    expect(firstStuck(detector(), running(1), 20)).toBe(8);
  });

  it('gives a script with a longer limit longer', () => {
    expect(firstStuck(detector(), running(1, 300_000), 305)).toBeNull();
    expect(firstStuck(detector(), running(1, 300_000), 310)).toBe(307);
  });

  it('never says stuck when no script runs', () => {
    expect(firstStuck(detector(), { sequence: 1, limitMs: 0, channelId: null }, 1_000)).toBeNull();
  });

  it('starts again at every sign of life, so a busy server is never taken for a stuck one', () => {
    const d = detector();
    for (let i = 1; i <= 100; i += 1) expect(firstStuck(d, running(i), 7)).toBeNull();
  });

  it('does not count time nobody ran: a suspended machine wakes to at most two ticks', () => {
    const d = detector();
    d.tick(running(1), 1_000);
    expect(d.tick(running(1), 8 * 3_600_000)).toBe(false);
    // 2 s counted for the sleep, so five more ticks reach 7 s.
    expect(firstStuck(d, running(1), 20)).toBe(5);
  });

  it('counts a tick that came late on a loaded machine up to twice its interval', () => {
    const d = detector();
    d.tick(running(1), 1_000);
    expect(firstStuck(d, running(1), 20, 1_500)).toBe(5);
  });
});
