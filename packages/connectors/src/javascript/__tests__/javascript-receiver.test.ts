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
    // Its script would never end once the timers are real.
    await receiver.onHalt();
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

describe('JavaScriptReceiver stop and halt (#413)', () => {
  /** Holds the first message until it is let go. */
  function heldDispatcher(): { dispatch: (raw: RawMessage) => Promise<Result<DispatchResult>>; received: string[]; letGo: () => void } {
    const received: string[] = [];
    let letGo = (): void => undefined;
    const gate = new Promise<void>((resolve) => { letGo = resolve; });
    return {
      received,
      letGo: () => { letGo(); },
      dispatch: async (raw) => {
        received.push(raw.content);
        if (received.length === 1) await gate;
        return { ok: true as const, value: { messageId: received.length }, error: null };
      },
    };
  }

  it('a stop ends once everything the script returned is processed, and nothing is after it', async () => {
    const { dispatch, received, letGo } = heldDispatcher();
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(dispatch);
    receiver.setScriptRunner(makeScriptRunner(['a', 'b', 'c']));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);

    let atEnd: string[] | null = null;
    const stopping = receiver.onStop().then(() => { atEnd = [...received]; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(atEnd).toBeNull();
    letGo();
    await stopping;

    // Nothing else holds what the script returned, so it was taken.
    expect(atEnd).toEqual(['a', 'b', 'c']);
    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('a stop waits for a script under way and sends what it returns, which it may have taken from somewhere', async () => {
    const received: string[] = [];
    let scriptEnds = (): void => undefined;
    const script = new Promise<void>((resolve) => { scriptEnds = resolve; });
    let stopped = false;
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }));
    receiver.setDispatcher(makeDispatcher((raw) => { received.push(raw.content); return { messageId: 1 }; }));
    receiver.setScriptRunner(async () => { await script; return { ok: true as const, value: 'a', error: null }; });
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);

    const stopping = receiver.onStop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    scriptEnds();
    await stopping;

    expect(received).toEqual(['a']);
  });

  it('a halt does not wait and sends no more; the next start sends the rest before it runs the script again', async () => {
    const { dispatch, received, letGo } = heldDispatcher();
    const { logger, warnings } = makeMockLogger();
    const returned = [['a', 'b', 'c'], ['d']];
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(dispatch);
    receiver.setScriptRunner(async () => ({ ok: true as const, value: returned.shift() ?? null, error: null }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);

    expect((await receiver.onHalt()).ok).toBe(true);
    letGo();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toEqual(['a']);
    expect(warnings.map((w) => w.obj)).toContainEqual({ kept: 2 });

    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toEqual(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(received).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a halt keeps what a script returns after it', async () => {
    const received: string[] = [];
    let scriptEnds = (): void => undefined;
    const script = new Promise<void>((resolve) => { scriptEnds = resolve; });
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), makeMockLogger().logger);
    receiver.setDispatcher(makeDispatcher((raw) => { received.push(raw.content); return { messageId: 1 }; }));
    let runs = 0;
    receiver.setScriptRunner(async () => {
      runs += 1;
      if (runs === 1) await script;
      return { ok: true as const, value: runs === 1 ? 'a' : null, error: null };
    });
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);

    await receiver.onHalt();
    scriptEnds();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toEqual([]);

    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(received).toEqual(['a']);
  });

  it('sends what a halt kept at once when it starts again, however far off the next poll is', async () => {
    const { dispatch, received, letGo } = heldDispatcher();
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 3_600_000 }), makeMockLogger().logger);
    receiver.setDispatcher(dispatch);
    receiver.setScriptRunner(makeScriptRunner(['a', 'b', 'c']));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(3_600_000);
    await receiver.onHalt();
    letGo();
    await vi.advanceTimersByTimeAsync(0);

    await receiver.onStart();
    expect((await receiver.onStop()).ok).toBe(true);

    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('a start after a halt waits with the rest for the message in hand, and a stop of it finishes both', async () => {
    const { dispatch, received, letGo } = heldDispatcher();
    const { logger, warnings } = makeMockLogger();
    let runs = 0;
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(dispatch);
    receiver.setScriptRunner(async () => { runs += 1; return { ok: true as const, value: ['a', 'b', 'c'], error: null }; });
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);
    await receiver.onHalt();

    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toEqual(['a']);
    expect(runs).toBe(1);

    let atEnd: string[] | null = null;
    const stopping = receiver.onStop().then(() => { atEnd = [...received]; });
    await vi.advanceTimersByTimeAsync(0);
    expect(atEnd).toBeNull();
    letGo();
    await stopping;
    expect(atEnd).toEqual(['a', 'b', 'c']);
    expect(runs).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('a message whose dispatch throws does not keep the rest of the array from being sent', async () => {
    const received: string[] = [];
    const { logger, errors, warnings } = makeMockLogger();
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(async (raw) => {
      if (raw.content === 'b') throw new Error('dispatcher blew up');
      received.push(raw.content);
      return { ok: true as const, value: { messageId: 1 }, error: null };
    });
    receiver.setScriptRunner(makeScriptRunner(['a', 'b', 'c']));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(received).toEqual(['a', 'c']);
    expect(errors).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('a halt ends a stop that waits', async () => {
    const { dispatch, received, letGo } = heldDispatcher();
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), makeMockLogger().logger);
    receiver.setDispatcher(dispatch);
    receiver.setScriptRunner(makeScriptRunner(['a', 'b']));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);

    const stopping = receiver.onStop();
    await receiver.onHalt();
    expect((await stopping).ok).toBe(true);
    letGo();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(received).toEqual(['a']);
  });

  it('says how many messages an undeploy after a halt loses', async () => {
    const { dispatch, letGo } = heldDispatcher();
    const { logger, errors } = makeMockLogger();
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(dispatch);
    receiver.setScriptRunner(makeScriptRunner(['a', 'b', 'c']));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);
    await receiver.onHalt();

    await receiver.onUndeploy();
    letGo();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(errors.map((e) => e.obj)).toEqual([{ lost: 2 }]);
  });

  it('says so when a script that a halt did not wait for returns messages after an undeploy', async () => {
    const { logger, errors } = makeMockLogger();
    let scriptEnds = (): void => undefined;
    const script = new Promise<void>((resolve) => { scriptEnds = resolve; });
    receiver = new JavaScriptReceiver(makeConfig({ pollingIntervalMs: 1_000 }), logger);
    receiver.setDispatcher(makeDispatcher());
    receiver.setScriptRunner(async () => { await script; return { ok: true as const, value: ['a', 'b'], error: null }; });
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(1_000);
    await receiver.onHalt();
    await receiver.onUndeploy();

    scriptEnds();
    await vi.advanceTimersByTimeAsync(0);

    expect(errors.map((e) => e.obj)).toEqual([{ lost: 2 }]);
  });
});
