import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import { stderr, type Result } from '@galvanigraph/core-util';
import { JavaScriptReceiver, normalizeScriptResult, type JavaScriptReceiverConfig, type ScriptRunner } from '../javascript-receiver.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

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
    error: stderr({ name: 'Error', message, code: 'SCRIPT_ERROR' }),
  });
}

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

  it('makes every array item a message, and skips the ones that hold none (#415)', () => {
    expect(normalizeScriptResult(['a', 42, 'b', null, '', undefined, { id: 7 }, ['x', 'y'], 0]))
      .toEqual(['a', '42', 'b', '{"id":7}', '["x","y"]', '0']);
  });

  it('skips what is left of a promise, and an item a condition left out', () => {
    expect(normalizeScriptResult([{}, 'a', [], false, true])).toEqual(['a']);
    expect(normalizeScriptResult({})).toEqual([]);
  });

  it('stringifies a boolean that is the whole result', () => {
    expect(normalizeScriptResult(false)).toEqual(['false']);
  });

  it('stringifies a number', () => {
    expect(normalizeScriptResult(42)).toEqual(['42']);
  });

  it('makes an object JSON text', () => {
    expect(normalizeScriptResult({ key: 'val', toString: 'data' })).toEqual(['{"key":"val","toString":"data"}']);
  });

  it('takes the text of a message object, which is how the engine hands back a parsed message', () => {
    expect(normalizeScriptResult({ get: () => '', toString: () => 'MSH|^~\\&|' })).toEqual(['MSH|^~\\&|']);
  });

  it('returns empty array for empty array', () => {
    expect(normalizeScriptResult([])).toEqual([]);
  });
});

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

  it('says how many array items held no message (#415)', async () => {
    const { logger, warnings } = makeMockLogger();
    const dispatched: string[] = [];
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw.content); return { messageId: 1 }; }));
    receiver.setScriptRunner(makeScriptRunner(['secret', null, { id: 7 }, '']));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(dispatched).toEqual(['secret', '{"id":7}']);
    expect(warnings).toEqual([{ obj: { items: 4, skipped: 2 }, msg: expect.stringContaining('skipped') as string }]);
  });

  it('says that an object without data, which a promise becomes, was not sent (#415)', async () => {
    const { logger, warnings } = makeMockLogger();
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(makeDispatcher());
    receiver.setScriptRunner(makeScriptRunner({}));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(warnings).toEqual([{ obj: { items: 1, skipped: 1 }, msg: expect.stringContaining('promise') as string }]);
  });

  it('logs nothing about items when every one is a message, or there are none', async () => {
    const { logger, warnings } = makeMockLogger();
    let value: unknown = ['a', 1];
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(makeDispatcher());
    receiver.setScriptRunner(async () => ({ ok: true as const, value, error: null }));
    await receiver.onStart();

    for (value of [['a', 1], [], null, '']) await vi.advanceTimersByTimeAsync(1_000);

    expect(warnings).toEqual([]);
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

    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatched).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatched).toHaveLength(1);
  });

  it('logs an error when the poll cycle throws', async () => {
    const { logger, errors } = makeMockLogger();
    const throwingRunner: ScriptRunner = async () => { throw new Error('sandbox exploded'); };

    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(makeDispatcher());
    receiver.setScriptRunner(throwingRunner);
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.msg).toContain('poll cycle failed');
  });
});
