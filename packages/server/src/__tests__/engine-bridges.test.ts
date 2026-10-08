// ===========================================
// Engine IO Bridge Wiring Tests
// ===========================================
// Host-side behaviour of the getResource/httpFetch/routeMessage bridges wired
// into EngineManager. The sandbox-side mechanism is covered separately in
// packages/engine .../bridge-io-functions.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { EngineManager, type DeployedChannel } from '../engine.js';

// ----- routeMessage -----

function fakeDeployed(name: string, state = 'STARTED'): { deployed: DeployedChannel; processMessage: ReturnType<typeof vi.fn> } {
  const processMessage = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 42 } });
  const deployed = {
    channelId: `id-${name}`,
    config: { name },
    runtime: { getState: () => state },
    processMessage,
  } as unknown as DeployedChannel;
  return { deployed, processMessage };
}

/** Access the private runtimes map for test setup. */
function internals(engine: EngineManager): { runtimes: Map<string, DeployedChannel> } {
  return engine as unknown as { runtimes: Map<string, DeployedChannel> };
}

describe('EngineManager.routeMessage', () => {
  it('routes a raw message into a started channel resolved by name', async () => {
    const engine = new EngineManager();
    const { deployed, processMessage } = fakeDeployed('Target');
    internals(engine).runtimes.set('id-Target', deployed);

    const result = await engine.routeMessage('Target', 'MSH|raw');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messageId).toBe(42);
    expect(processMessage).toHaveBeenCalledWith('MSH|raw');
  });

  it('fails when no deployed channel has that name', async () => {
    const engine = new EngineManager();
    const result = await engine.routeMessage('Missing', 'x');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no deployed channel');
  });

  it('trips the loop guard when a message routes back to itself', async () => {
    const engine = new EngineManager();
    let hops = 0;
    const processMessage = vi.fn(async () => {
      hops++;
      // Each hop's script routes the message on again: a loop A -> A -> A ...
      const next = await engine.routeMessage('Loop', 'x');
      if (!next.ok) throw new Error(next.error.message);
      return { ok: true, value: { messageId: hops }, error: null };
    });
    internals(engine).runtimes.set('id-Loop', {
      channelId: 'id-Loop', config: { name: 'Loop' }, runtime: { getState: () => 'STARTED' }, processMessage,
    } as unknown as DeployedChannel);

    const result = await engine.routeMessage('Loop', 'x');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('max hop depth');
    expect(hops).toBe(25); // MAX_ROUTE_DEPTH
  });

  it('does not count concurrent, unrelated routeMessage calls against each other', async () => {
    const engine = new EngineManager();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const processMessage = vi.fn(async () => {
      await gate; // keep every call in flight at once
      return { ok: true, value: { messageId: 1 }, error: null };
    });
    internals(engine).runtimes.set('id-Target', {
      channelId: 'id-Target', config: { name: 'Target' }, runtime: { getState: () => 'STARTED' }, processMessage,
    } as unknown as DeployedChannel);

    const calls = Array.from({ length: 40 }, () => engine.routeMessage('Target', 'x'));
    release();
    const results = await Promise.all(calls);

    expect(results.every((r) => r.ok)).toBe(true);
  });
});
