// ===========================================
// JavaScript Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';
import { JavaScriptReceiver, normalizeScriptResult, type JavaScriptReceiverConfig, type ScriptRunner } from '../javascript-receiver.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<JavaScriptReceiverConfig>): JavaScriptReceiverConfig {
  return {
    script: 'return "hello";',
    pollingIntervalMs: 5_000,
    ...overrides,
  };
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler
      ? handler(raw)
      : { messageId: 1 },
    error: null,
  });
}

function makeScriptRunner(value: unknown): ScriptRunner {
  return async () => ({ ok: true as const, value, error: null });
}

function makeFailingRunner(message: string): ScriptRunner {
  return async () => ({
    ok: false as const,
    value: null,
    error: { name: 'Error', message, code: 'SCRIPT_ERROR' },
  });
}

// ----- Lifecycle -----

let receiver: JavaScriptReceiver | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  if (receiver) {
    await receiver.onStop();
    receiver = null;
  }
});

// ----- normalizeScriptResult -----

describe('normalizeScriptResult', () => {
  it('returns empty array for null', () => {
    expect(normalizeScriptResult(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(normalizeScriptResult(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(normalizeScriptResult('')).toEqual([]);
  });

  it('wraps non-empty string in array', () => {
    expect(normalizeScriptResult('hello')).toEqual(['hello']);
  });

  it('filters string arrays, removing non-strings', () => {
    expect(normalizeScriptResult(['a', 42, 'b', null, ''])).toEqual(['a', 'b']);
  });

  it('stringifies non-string, non-array values', () => {
    expect(normalizeScriptResult(42)).toEqual(['42']);
  });

  it('stringifies objects', () => {
    const result = normalizeScriptResult({ key: 'val' });
    expect(result).toEqual(['[object Object]']);
  });

  it('returns empty array for empty array', () => {
    expect(normalizeScriptResult([])).toEqual([]);
  });
});

// ----- onDeploy -----

describe('JavaScriptReceiver.onDeploy', () => {
  it('succeeds with valid config', async () => {
    receiver = new JavaScriptReceiver(makeConfig());
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when script is empty', async () => {
    receiver = new JavaScriptReceiver(makeConfig({ script: '' }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when polling interval is below 100ms', async () => {
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 50 }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });
});

// ----- onStart / onStop -----

describe('JavaScriptReceiver lifecycle', () => {
  it('starts and creates poll timer', async () => {
    receiver = new JavaScriptReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    const result = await receiver.onStart();
    expect(result.ok).toBe(true);
  });

  it('fails to start without dispatcher', async () => {
    receiver = new JavaScriptReceiver(makeConfig());
    const result = await receiver.onStart();
    expect(result.ok).toBe(false);
  });

  it('stops cleanly', async () => {
    receiver = new JavaScriptReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    const result = await receiver.onStop();
    expect(result.ok).toBe(true);
  });

  it('halts cleanly', async () => {
    receiver = new JavaScriptReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    const result = await receiver.onHalt();
    expect(result.ok).toBe(true);
  });

  it('undeploys and clears references', async () => {
    receiver = new JavaScriptReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    const result = await receiver.onUndeploy();
    expect(result.ok).toBe(true);
  });
});

// ----- Polling -----

describe('JavaScriptReceiver poll cycle', () => {
  it('dispatches string result from script runner', async () => {
    const dispatched: RawMessage[] = [];
    const dispatcher = async (raw: RawMessage): Promise<Result<DispatchResult>> => {
      dispatched.push(raw);
      return { ok: true as const, value: { messageId: 1 }, error: null };
    };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(dispatcher);
    receiver.setScriptRunner(makeScriptRunner('test message'));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.content).toBe('test message');
    expect(dispatched[0]?.sourceMap).toHaveProperty('connectorType', 'JAVASCRIPT');
  });

  it('dispatches multiple messages from array result', async () => {
    const dispatched: RawMessage[] = [];
    const dispatcher = async (raw: RawMessage): Promise<Result<DispatchResult>> => {
      dispatched.push(raw);
      return { ok: true as const, value: { messageId: dispatched.length }, error: null };
    };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(dispatcher);
    receiver.setScriptRunner(makeScriptRunner(['msg1', 'msg2', 'msg3']));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(dispatched).toHaveLength(3);
    expect(dispatched[0]?.content).toBe('msg1');
    expect(dispatched[2]?.content).toBe('msg3');
  });

  it('dispatches nothing when script returns null', async () => {
    const dispatched: RawMessage[] = [];
    const dispatcher = async (raw: RawMessage): Promise<Result<DispatchResult>> => {
      dispatched.push(raw);
      return { ok: true as const, value: { messageId: 1 }, error: null };
    };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(dispatcher);
    receiver.setScriptRunner(makeScriptRunner(null));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(dispatched).toHaveLength(0);
  });

  it('dispatches nothing when script runner fails', async () => {
    const dispatched: RawMessage[] = [];
    const dispatcher = async (raw: RawMessage): Promise<Result<DispatchResult>> => {
      dispatched.push(raw);
      return { ok: true as const, value: { messageId: 1 }, error: null };
    };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(dispatcher);
    receiver.setScriptRunner(makeFailingRunner('script error'));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(dispatched).toHaveLength(0);
  });

  it('dispatches nothing without script runner (fallback)', async () => {
    const dispatched: RawMessage[] = [];
    const dispatcher = async (raw: RawMessage): Promise<Result<DispatchResult>> => {
      dispatched.push(raw);
      return { ok: true as const, value: { messageId: 1 }, error: null };
    };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(dispatcher);
    // No setScriptRunner call — tests fallback path
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(dispatched).toHaveLength(0);
  });

  it('prevents concurrent poll cycles', async () => {
    let callCount = 0;
    const slowRunner: ScriptRunner = async () => {
      callCount++;
      // Simulate slow execution
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { ok: true as const, value: 'result', error: null };
    };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 500 }));
    receiver.setDispatcher(makeDispatcher());
    receiver.setScriptRunner(slowRunner);
    await receiver.onStart();

    // First tick triggers poll; second tick should be skipped because first is still running
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);

    expect(callCount).toBe(1);
  });

  it('continues polling after script error', async () => {
    let callCount = 0;
    const errorThenSuccess: ScriptRunner = async () => {
      callCount++;
      if (callCount === 1) throw new Error('first call fails');
      return { ok: true as const, value: 'success', error: null };
    };

    const dispatched: RawMessage[] = [];
    const dispatcher = async (raw: RawMessage): Promise<Result<DispatchResult>> => {
      dispatched.push(raw);
      return { ok: true as const, value: { messageId: 1 }, error: null };
    };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(dispatcher);
    receiver.setScriptRunner(errorThenSuccess);
    await receiver.onStart();

    // First poll: error
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatched).toHaveLength(0);

    // Second poll: success
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatched).toHaveLength(1);
  });
});
