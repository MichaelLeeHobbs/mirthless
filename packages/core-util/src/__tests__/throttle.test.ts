import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createThrottle } from '../throttle.js';

describe('createThrottle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs the first call at once', () => {
    const fn = vi.fn();
    createThrottle(fn, 1000).call();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('turns a burst inside one window into one leading and one trailing run', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 1000);

    for (let i = 0; i < 50; i++) throttle.call();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs at most once per window under steady load, and once after the last call', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 1000);

    // One call every 10 ms for 2.95 s (295 calls), which spans three windows.
    for (let t = 0; t < 2950; t += 10) {
      throttle.call();
      vi.advanceTimersByTime(10);
    }
    const duringBurst = fn.mock.calls.length;
    expect(duringBurst).toBe(3);

    vi.advanceTimersByTime(1000);
    expect(fn.mock.calls.length).toBe(duringBurst + 1);
    vi.advanceTimersByTime(5000);
    expect(fn.mock.calls.length).toBe(duringBurst + 1);
  });

  it('runs a call at once again after a quiet window', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 1000);
    throttle.call();
    vi.advanceTimersByTime(1000);
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps throttling after the function throws', () => {
    const fn = vi.fn(() => { throw new Error('boom'); });
    const throttle = createThrottle(fn, 1000);
    expect(() => { throttle.call(); }).toThrow('boom');
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('drops the pending trailing run on cancel and still works afterwards', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 1000);
    throttle.call();
    throttle.call();
    throttle.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);

    throttle.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
