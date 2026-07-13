// ===========================================
// Timeout Utility Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, withTimeoutSignal, TimeoutError } from '../timeout.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves with the value when the promise settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1_000, 'op');
    expect(result).toBe('ok');
  });

  it('rejects with a TimeoutError when the operation hangs past the budget', async () => {
    const hung = new Promise<string>(() => { /* never settles */ });
    const raced = withTimeout(hung, 1_000, 'hung op');
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});

describe('withTimeoutSignal', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withTimeoutSignal(Promise.resolve('x'), 1_000, 'op', controller.signal),
    ).rejects.toThrow();
  });

  it('rejects when the signal fires before the promise settles', async () => {
    const controller = new AbortController();
    const hung = new Promise<string>(() => { /* never settles */ });
    const raced = withTimeoutSignal(hung, 10_000, 'op', controller.signal);
    const assertion = expect(raced).rejects.toThrow();
    controller.abort();
    await assertion;
  });

  it('times out when neither the promise nor the signal settle in time', async () => {
    const controller = new AbortController();
    const hung = new Promise<string>(() => { /* never */ });
    const raced = withTimeoutSignal(hung, 1_000, 'op', controller.signal);
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
