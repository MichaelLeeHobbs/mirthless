import { describe, expect, it, vi } from 'vitest';
import type { ScriptWatch } from '@galvanigraph/engine/script-watch';
import { endStuckServer, STILL_HERE_MS, type StuckScriptDeps } from '../stuck-script.js';

const CHANNEL = 'b5a7c1de-0000-4000-8000-00000000000a';
const STUCK: ScriptWatch = { sequence: 7, limitMs: 300, channelId: CHANNEL };
const TICK_MS = 100;

interface World {
  readonly deps: StuckScriptDeps;
  readonly events: string[];
  /** The main thread shows a sign of life. */
  readonly revive: () => void;
}

/** `killWorks`: the kill ends everything, which shows here as a sleep that never ends. */
function world(options: { readonly hold?: () => Promise<boolean>; readonly release?: () => Promise<void>; readonly killWorks: boolean }): World {
  const events: string[] = [];
  let sequence = STUCK.sequence;
  let killed = false;
  return {
    events,
    revive: () => { sequence += 1; },
    deps: {
      tickMs: TICK_MS,
      read: () => ({ ...STUCK, sequence }),
      hold: async (id) => { events.push(`hold ${id}`); return (options.hold ?? (async () => true))(); },
      release: async (id) => { events.push(`release ${id}`); await options.release?.(); },
      kill: () => { events.push('kill'); killed = options.killWorks; },
      log: async (fields, msg) => { events.push(`log ${JSON.stringify(fields)} ${msg}`); },
      sleep: async (ms) => {
        if (killed) await new Promise(() => {});
        events.push(`sleep ${String(ms)}`);
      },
    },
  };
}

/** Until the world is killed or the server turns out to live. */
async function run(w: World): Promise<'killed' | 'lives'> {
  const ended = endStuckServer(STUCK, w.deps).then(() => 'lives' as const);
  const killed = vi.waitUntil(() => w.events.includes('kill')).then(() => 'killed' as const);
  return Promise.race([ended, killed]);
}

const logs = (w: World): string => w.events.filter((e) => e.startsWith('log')).join('\n');

describe('endStuckServer', () => {
  it('holds the channel, then ends the process', async () => {
    const w = world({ killWorks: true });
    expect(await run(w)).toBe('killed');
    expect(w.events.indexOf(`hold ${CHANNEL}`)).toBeLessThan(w.events.indexOf('kill'));
    expect(logs(w)).toContain('"held":true} The channel stays undeployed');
  });

  it('ends the process when the hold fails, with the reason', async () => {
    const w = world({ killWorks: true, hold: async () => { throw new Error('connection refused'); } });
    expect(await run(w)).toBe('killed');
    expect(logs(w)).toContain('"errMsg":"connection refused"');
    expect(logs(w)).toContain('could not be held');
  });

  it('says when there was no deployment to hold', async () => {
    const w = world({ killWorks: true, hold: async () => false });
    expect(await run(w)).toBe('killed');
    expect(logs(w)).toContain('"held":false} The channel has no deployment to hold');
  });

  it('holds nothing for a script of no channel', async () => {
    const w = world({ killWorks: true });
    const ended = endStuckServer({ ...STUCK, channelId: null }, w.deps);
    await vi.waitUntil(() => w.events.includes('kill'));
    expect(w.events.some((e) => e.startsWith('hold'))).toBe(false);
    await Promise.race([ended, Promise.resolve()]);
  });

  it('does not end a server whose script ended by itself during the hold, and removes the hold', async () => {
    const w: World = world({ killWorks: true, hold: async () => { w.revive(); return true; } });
    expect(await run(w)).toBe('lives');
    expect(w.events).not.toContain('kill');
    expect(w.events.at(-1)).toBe(`release ${CHANNEL}`);
    expect(logs(w)).toContain('ended by itself');
  });

  it('removes the hold also when it seemed to fail, since its reply may be all that was lost', async () => {
    const w: World = world({ killWorks: true, hold: async () => { w.revive(); throw new Error('down'); } });
    expect(await run(w)).toBe('lives');
    expect(w.events.at(-1)).toBe(`release ${CHANNEL}`);
  });

  it('says when a hold could not be removed', async () => {
    const w: World = world({
      killWorks: true, hold: async () => { w.revive(); return true; }, release: async () => { throw new Error('gone'); },
    });
    expect(await run(w)).toBe('lives');
    expect(logs(w)).toContain('"errMsg":"gone"');
    expect(logs(w)).toContain('could not be removed');
  });

  it('where the kill does nothing, says so and keeps the hold until the script ends', async () => {
    const w = world({ killWorks: false });
    let ticks = 0;
    const deps: StuckScriptDeps = {
      ...w.deps,
      sleep: async (ms) => { await w.deps.sleep(ms); if (ms === TICK_MS) { ticks += 1; if (ticks === 3) w.revive(); } },
    };
    await endStuckServer(STUCK, deps);
    expect(w.events.filter((e) => e === 'kill')).toHaveLength(1);
    expect(w.events).toContain(`sleep ${String(STILL_HERE_MS)}`);
    expect(logs(w)).toContain('could not be ended');
    expect(ticks).toBe(3);
    expect(w.events.at(-1)).toBe(`release ${CHANNEL}`);
  });
});
