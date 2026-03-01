// ===========================================
// Channel Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import { ChannelDispatcher, type ChannelDispatcherConfig } from '../channel-dispatcher.js';
import { registerChannel, clearChannelRegistry } from '../channel-registry.js';
import type { RawMessage } from '../../base.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<ChannelDispatcherConfig>): ChannelDispatcherConfig {
  return {
    targetChannelId: 'target-ch-001',
    waitForResponse: false,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: 'source-ch-001',
    messageId: 42,
    metaDataId: 1,
    content: 'test content',
    dataType: 'RAW',
    ...overrides,
  };
}

function makeSignal(aborted = false): AbortSignal {
  if (aborted) return AbortSignal.abort();
  return new AbortController().signal;
}

// ----- Lifecycle -----

beforeEach(() => {
  vi.clearAllMocks();
  clearChannelRegistry();
});

afterEach(() => {
  clearChannelRegistry();
});

// ----- onDeploy -----

describe('ChannelDispatcher.onDeploy', () => {
  it('succeeds with valid config', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when targetChannelId is empty', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig({ targetChannelId: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });
});

// ----- Lifecycle -----

describe('ChannelDispatcher lifecycle', () => {
  it('starts successfully', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    const result = await dispatcher.onStart();
    expect(result.ok).toBe(true);
  });

  it('stops successfully', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onStop();
    expect(result.ok).toBe(true);
  });

  it('halts successfully', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onHalt();
    expect(result.ok).toBe(true);
  });

  it('undeploys successfully', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    const result = await dispatcher.onUndeploy();
    expect(result.ok).toBe(true);
  });
});

// ----- send -----

describe('ChannelDispatcher.send', () => {
  it('dispatches message to target channel', async () => {
    const received: RawMessage[] = [];
    registerChannel('target-ch-001', async (raw) => {
      received.push(raw);
      return { ok: true as const, value: { messageId: 100 }, error: null };
    });

    const dispatcher = new ChannelDispatcher(makeConfig());
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toBe('messageId=100');
    }

    expect(received).toHaveLength(1);
    expect(received[0]?.content).toBe('test content');
  });

  it('includes source metadata in sourceMap', async () => {
    const received: RawMessage[] = [];
    registerChannel('target-ch-001', async (raw) => {
      received.push(raw);
      return { ok: true as const, value: { messageId: 1 }, error: null };
    });

    const dispatcher = new ChannelDispatcher(makeConfig());
    await dispatcher.onStart();

    await dispatcher.send(makeMessage({ channelId: 'src-ch', messageId: 55, metaDataId: 3 }), makeSignal());

    expect(received[0]?.sourceMap).toEqual({
      connectorType: 'CHANNEL',
      sourceChannelId: 'src-ch',
      sourceMessageId: 55,
      sourceMetaDataId: 3,
    });
  });

  it('returns ERROR when target channel is not registered', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig({ targetChannelId: 'nonexistent' }));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ERROR');
      expect(result.value.errorMessage).toContain('not deployed');
    }
  });

  it('returns ERROR when target dispatch fails', async () => {
    registerChannel('target-ch-001', async () => ({
      ok: false as const,
      value: null,
      error: { name: 'Error', message: 'pipeline error', code: 'PIPELINE_ERROR' },
    }));

    const dispatcher = new ChannelDispatcher(makeConfig());
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ERROR');
      expect(result.value.errorMessage).toBe('pipeline error');
    }
  });

  it('returns response when waitForResponse is true', async () => {
    registerChannel('target-ch-001', async () => ({
      ok: true as const,
      value: { messageId: 1, response: 'ACK response' },
      error: null,
    }));

    const dispatcher = new ChannelDispatcher(makeConfig({ waitForResponse: true }));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toBe('ACK response');
    }
  });

  it('returns messageId when waitForResponse is false even if response exists', async () => {
    registerChannel('target-ch-001', async () => ({
      ok: true as const,
      value: { messageId: 77, response: 'ignored' },
      error: null,
    }));

    const dispatcher = new ChannelDispatcher(makeConfig({ waitForResponse: false }));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('messageId=77');
    }
  });

  it('fails when not started', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('fails when signal is aborted', async () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.send(makeMessage(), makeSignal(true));
    expect(result.ok).toBe(false);
  });

  it('isTargetAvailable returns true when target is registered', () => {
    registerChannel('target-ch-001', async () => ({
      ok: true as const, value: { messageId: 1 }, error: null,
    }));
    const dispatcher = new ChannelDispatcher(makeConfig());
    expect(dispatcher.isTargetAvailable()).toBe(true);
  });

  it('isTargetAvailable returns false when target is not registered', () => {
    const dispatcher = new ChannelDispatcher(makeConfig());
    expect(dispatcher.isTargetAvailable()).toBe(false);
  });
});
