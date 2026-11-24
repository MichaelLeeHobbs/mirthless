import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settleWithin } from '../settle-within.js';

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
});
