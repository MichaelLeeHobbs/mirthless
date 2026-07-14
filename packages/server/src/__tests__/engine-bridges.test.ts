// ===========================================
// Engine IO Bridge Wiring Tests
// ===========================================
// Host-side behaviour of the getResource/httpFetch/routeMessage bridges wired
// into EngineManager. The sandbox-side mechanism is covered separately in
// packages/engine .../bridge-io-functions.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EngineManager, createHttpFetchBridge, type DeployedChannel } from '../engine.js';

// ----- httpFetch bridge -----

describe('createHttpFetchBridge', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('performs a GET by default and maps status/headers/body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('hello', { status: 201, statusText: 'Created', headers: { 'content-type': 'text/plain' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const bridge = createHttpFetchBridge();
    const result = await bridge('https://example.org/x', {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(result.status).toBe(201);
    expect(result.statusText).toBe('Created');
    expect(result.headers['content-type']).toBe('text/plain');
    expect(result.body).toBe('hello');
  });

  it('forwards method, headers, and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const bridge = createHttpFetchBridge();
    await bridge('https://example.org/x', { method: 'POST', headers: { 'x-api-key': 'k' }, body: '{"a":1}' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

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

/** Access the private runtimes map / routeDepth for test setup. */
function internals(engine: EngineManager): { runtimes: Map<string, DeployedChannel>; routeDepth: number } {
  return engine as unknown as { runtimes: Map<string, DeployedChannel>; routeDepth: number };
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

  it('trips the loop guard at max hop depth', async () => {
    const engine = new EngineManager();
    const { deployed } = fakeDeployed('Target');
    internals(engine).runtimes.set('id-Target', deployed);
    internals(engine).routeDepth = 25; // MAX_ROUTE_DEPTH

    const result = await engine.routeMessage('Target', 'x');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('max hop depth');
  });
});
