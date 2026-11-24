import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settleWithin, withTimeout, withTimeoutSignal, TimeoutError } from '../timeout.js';

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

describe('settleWithin', () => {
  it.each([
    ['resolves', (): Promise<unknown> => Promise.resolve('x')],
    ['rejects', (): Promise<unknown> => Promise.reject(new Error('broken'))],
  ])('ends when the work %s, and keeps no timer', async (_how, work) => {
    await settleWithin(work(), 1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends when the time is up, and not before', async () => {
    let ended = false;
    const waiting = settleWithin(new Promise(() => { /* never settles */ }), 1_000).then(() => { ended = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
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
