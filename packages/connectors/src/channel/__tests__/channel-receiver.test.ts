// ===========================================
// Channel Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';
import { ChannelReceiver, type ChannelReceiverConfig } from '../channel-receiver.js';
import { getChannelDispatcher, clearChannelRegistry, hasChannel } from '../channel-registry.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<ChannelReceiverConfig>): ChannelReceiverConfig {
  return {
    channelId: 'test-channel-001',
    ...overrides,
  };
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler ? handler(raw) : { messageId: 1 },
    error: null,
  });
}

// ----- Lifecycle -----

let receiver: ChannelReceiver | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  clearChannelRegistry();
});

afterEach(async () => {
  if (receiver) {
    await receiver.onStop();
    receiver = null;
  }
  clearChannelRegistry();
});

// ----- onDeploy -----

describe('ChannelReceiver.onDeploy', () => {
  it('succeeds with valid config', async () => {
    receiver = new ChannelReceiver(makeConfig());
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when channelId is empty', async () => {
    receiver = new ChannelReceiver(makeConfig({ channelId: '' }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });
});

// ----- onStart -----

describe('ChannelReceiver.onStart', () => {
  it('registers channel in the registry on start', async () => {
    receiver = new ChannelReceiver(makeConfig({ channelId: 'ch-abc' }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();

    expect(hasChannel('ch-abc')).toBe(true);
    const dispatcher = getChannelDispatcher('ch-abc');
    expect(dispatcher).toBeDefined();
  });

  it('fails when dispatcher not set', async () => {
    receiver = new ChannelReceiver(makeConfig());
    const result = await receiver.onStart();
    expect(result.ok).toBe(false);
  });

  it('registered dispatcher forwards messages', async () => {
    const dispatched: RawMessage[] = [];
    receiver = new ChannelReceiver(makeConfig({ channelId: 'ch-fwd' }));
    receiver.setDispatcher(async (raw) => {
      dispatched.push(raw);
      return { ok: true as const, value: { messageId: 99 }, error: null };
    });
    await receiver.onStart();

    const dispatcher = getChannelDispatcher('ch-fwd');
    expect(dispatcher).toBeDefined();

    const result = await dispatcher!({ content: 'test', sourceMap: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageId).toBe(99);
    }
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.content).toBe('test');
  });
});

// ----- onStop -----

describe('ChannelReceiver.onStop', () => {
  it('unregisters channel from registry', async () => {
    receiver = new ChannelReceiver(makeConfig({ channelId: 'ch-stop' }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    expect(hasChannel('ch-stop')).toBe(true);

    await receiver.onStop();
    expect(hasChannel('ch-stop')).toBe(false);
    receiver = null; // Already stopped
  });
});

// ----- onHalt -----

describe('ChannelReceiver.onHalt', () => {
  it('unregisters channel from registry on halt', async () => {
    receiver = new ChannelReceiver(makeConfig({ channelId: 'ch-halt' }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();

    await receiver.onHalt();
    expect(hasChannel('ch-halt')).toBe(false);
    receiver = null; // Already halted
  });
});

// ----- onUndeploy -----

describe('ChannelReceiver.onUndeploy', () => {
  it('unregisters channel and clears dispatcher', async () => {
    receiver = new ChannelReceiver(makeConfig({ channelId: 'ch-undep' }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    await receiver.onStop();

    const result = await receiver.onUndeploy();
    expect(result.ok).toBe(true);
    expect(hasChannel('ch-undep')).toBe(false);
    receiver = null;
  });
});

// ----- Multiple channels -----

describe('ChannelReceiver multiple instances', () => {
  it('can register multiple channels simultaneously', async () => {
    const r1 = new ChannelReceiver(makeConfig({ channelId: 'ch-1' }));
    const r2 = new ChannelReceiver(makeConfig({ channelId: 'ch-2' }));

    r1.setDispatcher(makeDispatcher());
    r2.setDispatcher(makeDispatcher());

    await r1.onStart();
    await r2.onStart();

    expect(hasChannel('ch-1')).toBe(true);
    expect(hasChannel('ch-2')).toBe(true);

    await r1.onStop();
    expect(hasChannel('ch-1')).toBe(false);
    expect(hasChannel('ch-2')).toBe(true);

    await r2.onStop();
    expect(hasChannel('ch-2')).toBe(false);
  });
});
