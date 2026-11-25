import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailureLimit, type Admission } from '../failure-limit.js';

const OPTIONS = { max: 3, windowMs: 60_000, maxWaiting: 4, maxWaitMs: 1_000, maxUnderWayMs: 5_000 } as const;
const KEY = '192.0.2.1';

let limit: FailureLimit;

beforeEach(() => {
  vi.useFakeTimers();
  limit = new FailureLimit(OPTIONS);
});

afterEach(() => {
  vi.useRealTimers();
});

const admit = (key = KEY, signal = new AbortController().signal): Promise<Admission> => limit.admit(key, signal);

async function started(key = KEY, signal = new AbortController().signal): Promise<(succeeded: boolean) => void> {
  const admission = await admit(key, signal);
  if (!admission.admitted) throw new Error(`Refused: ${admission.why}`);
  return admission.settle;
}

async function fail(times: number, key = KEY): Promise<void> {
  for (let i = 0; i < times; i++) (await started(key))(false);
}

describe('FailureLimit', () => {
  it('lets any number of attempts in that succeed', async () => {
    for (let i = 0; i < 20; i++) (await started())(true);

    expect((await admit()).admitted).toBe(true);
  });

  it('refuses attempts once the limit has failed, and says how long that lasts', async () => {
    await fail(1);
    vi.advanceTimersByTime(10_000);
    await fail(2);

    expect(await admit()).toEqual({ admitted: false, why: 'FAILURES', retryAfterMs: 50_000 });
  });

  it('lets attempts in again when the window that the first failure opened ends', async () => {
    await fail(3);
    vi.advanceTimersByTime(59_999);
    expect((await admit()).admitted).toBe(false);
    vi.advanceTimersByTime(1);

    expect((await admit()).admitted).toBe(true);
  });

  it('never has more failures and attempts under way together than the limit', async () => {
    await fail(1);
    await started();
    await started();
    const third = vi.fn();
    void admit().then(third);
    await vi.advanceTimersByTimeAsync(0);

    expect(third).not.toHaveBeenCalled();
  });

  it('gives a place that a success frees to the attempt that has waited longest', async () => {
    const [first] = [await started(), await started(), await started()];
    const order: string[] = [];
    void admit().then(() => order.push('fourth'));
    void admit().then(() => order.push('fifth'));
    first(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(['fourth']);
  });

  it('keeps a place that a failure used, and refuses those that wait once the limit has failed', async () => {
    const under = [await started(), await started(), await started()];
    const waiting = [admit(), admit()];
    for (const settle of under) settle(false);

    expect(await Promise.all(waiting)).toEqual([
      { admitted: false, why: 'FAILURES', retryAfterMs: 60_000 }, { admitted: false, why: 'FAILURES', retryAfterMs: 60_000 },
    ]);
  });

  it('counts a failure of an attempt that a window\'s end overtook in the next window', async () => {
    await fail(2);
    vi.advanceTimersByTime(59_000);
    const late = await started();
    vi.advanceTimersByTime(1_000);
    late(false);
    await fail(2);

    expect(await admit()).toEqual({ admitted: false, why: 'FAILURES', retryAfterMs: 60_000 });
  });

  it('lets those that wait in when the window ends', async () => {
    await fail(2);
    vi.advanceTimersByTime(59_500);
    await started();
    const waiting = admit();
    vi.advanceTimersByTime(500);

    expect((await waiting).admitted).toBe(true);
  });

  it('takes one outcome per attempt', async () => {
    const settle = await started();
    settle(true);
    settle(false);
    settle(false);
    await fail(2);

    expect((await admit()).admitted).toBe(true);
  });

  it('counts an attempt that is not settled in time as failed, and gives its place to nobody', async () => {
    const [first] = [await started(), await started()];
    const waiting = admit();
    expect((await waiting).admitted).toBe(true);
    vi.advanceTimersByTime(4_999);
    first(true);
    vi.advanceTimersByTime(1);
    first(false);

    await fail(1);
    expect((await admit()).admitted).toBe(false);
  });

  it('frees no place by a time that was up for an attempt already settled', async () => {
    (await started())(true);
    await started();
    vi.advanceTimersByTime(5_000);
    await fail(1);

    expect((await admit()).admitted).toBe(true);
  });

  it('counts an attempt that is gone while it is under way as failed', async () => {
    const gone = [new AbortController(), new AbortController(), new AbortController()];
    for (const each of gone) await started(KEY, each.signal);
    for (const each of gone) each.abort();

    expect(await admit()).toEqual({ admitted: false, why: 'FAILURES', retryAfterMs: 60_000 });
  });

  it('counts one that waited and was gone once it had its place', async () => {
    const [first] = [await started(), await started(), await started()];
    const gone = new AbortController();
    const waiting = admit(KEY, gone.signal);
    first(true);
    gone.abort();
    expect((await waiting).admitted).toBe(true);
    // Two under way and one failed leave no place.
    const next = vi.fn();
    void admit().then(next);
    await vi.advanceTimersByTimeAsync(0);
    expect(next).not.toHaveBeenCalled();
  });

  it('takes nothing from those that wait when the time of one that got its place is up', async () => {
    const [first, second] = [await started(), await started(), await started()];
    void admit();
    vi.advanceTimersByTime(500);
    const later = admit();
    first(true);
    vi.advanceTimersByTime(600);
    second(true);

    expect((await later).admitted).toBe(true);
  });

  it('refuses an attempt that waited too long, and one when too many wait', async () => {
    for (let i = 0; i < OPTIONS.max; i++) await started();
    const waiting = Array.from({ length: OPTIONS.maxWaiting }, () => admit());

    expect(await admit()).toEqual({ admitted: false, why: 'BUSY' });
    vi.advanceTimersByTime(OPTIONS.maxWaitMs);
    expect(await Promise.all(waiting)).toEqual(Array.from({ length: OPTIONS.maxWaiting }, () => ({ admitted: false, why: 'BUSY' })));
  });

  it('gives no place to one that is gone, before it waited or while it did', async () => {
    expect(await admit(KEY, AbortSignal.abort())).toEqual({ admitted: false, why: 'GONE' });
    const [first] = [await started(), await started(), await started()];
    const gone = new AbortController();
    const waiting = admit(KEY, gone.signal);
    const next = admit();
    gone.abort();
    first(true);

    expect(await waiting).toEqual({ admitted: false, why: 'GONE' });
    expect((await next).admitted).toBe(true);
  });

  it('counts each key on its own', async () => {
    await fail(3);

    expect((await admit('192.0.2.2')).admitted).toBe(true);
  });

  it('holds nothing for a key with no failures and nothing under way', async () => {
    const { entries } = limit as unknown as { entries: ReadonlyMap<string, unknown> };
    for (let i = 0; i < 100; i++) (await started(`key-${String(i)}`))(true);
    expect(vi.getTimerCount()).toBe(0);
    await fail(3, 'failed');
    expect([...entries.keys()]).toEqual(['failed']);
    vi.advanceTimersByTime(60_000);

    expect(entries.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
