import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settleUnlessAborted, settleWithin } from '../settle-within.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('settleWithin', () => {
  it.each([
    ['resolves', (): Promise<unknown> => Promise.resolve(false)],
    ['rejects', (): Promise<unknown> => Promise.reject(new Error('broken'))],
  ])('ends when the work %s, says so, and keeps no timer', async (_how, work) => {
    expect(await settleWithin(work(), 1_000)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends when the time is up, and not before, and says that the work had not ended', async () => {
    const ended: boolean[] = [];
    const waiting = settleWithin(new Promise(() => { /* never settles */ }), 1_000).then((result) => { ended.push(result); });
    await vi.advanceTimersByTimeAsync(999);
    expect(ended).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(ended).toEqual([false]);
  });

  it('ends when the signal comes, says that the work had not ended, and keeps no timer and no listener', async () => {
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const waiting = settleWithin(new Promise(() => { /* never settles */ }), 1_000, controller.signal);
    controller.abort();
    expect(await waiting).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledOnce();
  });

  it('does not wait once the signal has come', async () => {
    expect(await settleWithin(new Promise(() => { /* never settles */ }), 1_000, AbortSignal.abort())).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no listener when the work ends first', async () => {
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    expect(await settleWithin(Promise.resolve(), 1_000, controller.signal)).toBe(true);
    expect(removed.mock.calls).toEqual(added.mock.calls);
  });
});

describe('settleUnlessAborted', () => {
  it.each([
    ['resolves', (): Promise<unknown> => Promise.resolve(false)],
    ['rejects', (): Promise<unknown> => Promise.reject(new Error('broken'))],
  ])('ends when the work %s, says so, and leaves no listener', async (_how, work) => {
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    expect(await settleUnlessAborted(work(), controller.signal)).toBe(true);
    expect(removed.mock.calls).toEqual(added.mock.calls);
  });

  it('waits however long the work takes, until the signal, and says that it had not ended', async () => {
    const controller = new AbortController();
    const ended: boolean[] = [];
    const waiting = settleUnlessAborted(new Promise(() => { /* never settles */ }), controller.signal).then((result) => { ended.push(result); });
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(ended).toEqual([]);
    controller.abort();
    await waiting;
    expect(ended).toEqual([false]);
  });

  it('does not wait once the signal has come', async () => {
    expect(await settleUnlessAborted(new Promise(() => { /* never settles */ }), AbortSignal.abort())).toBe(false);
  });
});
