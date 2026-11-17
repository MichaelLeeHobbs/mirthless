import { describe, expect, it, vi } from 'vitest';
import { KeyRowCeiling } from '../key-row-ceiling.js';

function ceiling(limit: number, seeded = 0, start = '2026-11-17T10:00:00Z'): { c: KeyRowCeiling; seed: ReturnType<typeof vi.fn>; clock: { now: Date } } {
  const clock = { now: new Date(start) };
  const seed = vi.fn(async () => seeded);
  return { c: new KeyRowCeiling({ limit, seed, now: () => clock.now }), seed, clock };
}

describe('KeyRowCeiling', () => {
  it('lets a key read up to the limit in a day and refuses the read that would pass it', async () => {
    const { c } = ceiling(10);
    expect(!!await c.take('k', 6)).toBe(true);
    expect(!!await c.take('k', 4)).toBe(true);
    expect(!!await c.take('k', 1)).toBe(false);
    // A refused read takes nothing, so a smaller one still fits only if it does.
    expect(!!await c.take('k', 0)).toBe(true);
  });

  it('refuses a single read bigger than the limit', async () => {
    const { c } = ceiling(5);
    expect(!!await c.take('k', 6)).toBe(false);
    expect(!!await c.take('k', 5)).toBe(true);
  });

  it('counts each key on its own', async () => {
    const { c } = ceiling(3);
    expect(!!await c.take('a', 3)).toBe(true);
    expect(!!await c.take('b', 3)).toBe(true);
    expect(!!await c.take('a', 1)).toBe(false);
  });

  it('starts from the rows the audit log already holds for today, read once per key and day', async () => {
    const { c, seed } = ceiling(10, 8);
    expect(!!await c.take('k', 3)).toBe(false);
    expect(!!await c.take('k', 2)).toBe(true);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith('k', new Date('2026-11-17T00:00:00Z'));
  });

  it('reads the audit log once even when the first reads of the day arrive together', async () => {
    const { c, seed } = ceiling(10, 0);
    const answers = (await Promise.all([c.take('k', 4), c.take('k', 4), c.take('k', 4)])).map((a) => a !== null);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(answers.filter(Boolean)).toHaveLength(2);
  });

  it('starts again at midnight UTC', async () => {
    const { c, seed, clock } = ceiling(5, 0, '2026-11-17T23:59:00Z');
    expect(!!await c.take('k', 5)).toBe(true);
    expect(!!await c.take('k', 1)).toBe(false);
    clock.now = new Date('2026-11-18T00:00:01Z');
    expect(!!await c.take('k', 5)).toBe(true);
    expect(seed).toHaveBeenLastCalledWith('k', new Date('2026-11-18T00:00:00Z'));
  });

  it('gives rows back when the read was not sent', async () => {
    const { c } = ceiling(5);
    const ticket = await c.take('k', 5);
    c.giveBack(ticket!);
    expect(!!await c.take('k', 5)).toBe(true);
    // Never below zero, and nothing for a key it has not seen.
    c.giveBack({ principalId: 'k', day: '2026-11-17', rows: 50 });
    c.giveBack({ principalId: 'other', day: '2026-11-17', rows: 3 });
    expect(!!await c.take('k', 5)).toBe(true);
  });

  it('gives rows back only to the day they were counted on', async () => {
    const { c, clock } = ceiling(5, 0, '2026-11-17T23:59:59Z');
    const lateRead = await c.take('k', 5);
    clock.now = new Date('2026-11-18T00:00:01Z');
    expect(!!await c.take('k', 5)).toBe(true);
    // The read from before midnight failed to record: its rows do not free up the new day.
    c.giveBack(lateRead!);
    expect(!!await c.take('k', 1)).toBe(false);
  });

  it('never lets a slow count for an earlier day replace a later day\'s', async () => {
    const clock = { now: new Date('2026-11-17T23:59:59Z') };
    let releaseOld: (n: number) => void = () => undefined;
    const seed = vi.fn((_id: string, since: Date) => (since.toISOString().startsWith('2026-11-17')
      ? new Promise<number>((resolve) => { releaseOld = resolve; })
      : Promise.resolve(0)));
    const c = new KeyRowCeiling({ limit: 5, seed, now: () => clock.now });
    const oldRead = c.take('k', 1);
    clock.now = new Date('2026-11-18T00:00:01Z');
    expect(!!await c.take('k', 4)).toBe(true);
    releaseOld(0);
    await oldRead;
    // The new day still holds its 4 rows: one more fits, two do not.
    expect(!!await c.take('k', 2)).toBe(false);
    expect(!!await c.take('k', 1)).toBe(true);
  });

  it('says once a day per key that the limit was reached', async () => {
    const { c, clock } = ceiling(1);
    await c.take('k', 1);
    expect(c.firstRefusalToday('k')).toBe(true);
    expect(c.firstRefusalToday('k')).toBe(false);
    // A record that could not be written is tried again at the next refusal.
    c.forgetRefusal('k');
    expect(c.firstRefusalToday('k')).toBe(true);
    clock.now = new Date('2026-11-18T01:00:00Z');
    await c.take('k', 1);
    expect(c.firstRefusalToday('k')).toBe(true);
  });

  it('fails closed when the audit log cannot be read: no rows for that key until it can', async () => {
    const clock = { now: new Date('2026-11-17T10:00:00Z') };
    const seed = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(0);
    const c = new KeyRowCeiling({ limit: 5, seed, now: () => clock.now });
    await expect(c.take('k', 1)).rejects.toThrow('db down');
    expect(!!await c.take('k', 1)).toBe(true);
    expect(c.limit).toBe(5);
  });
});

describe('KeyRowCeiling: the 80% warning (#301)', () => {
  function warned(limit: number, seeded = 0, alreadyWarned: boolean | Error = false): { c: KeyRowCeiling; clock: { now: Date } } {
    const clock = { now: new Date('2026-11-17T10:00:00Z') };
    const seedWarned = async (): Promise<boolean> => { if (alreadyWarned instanceof Error) throw alreadyWarned; return alreadyWarned; };
    const c = new KeyRowCeiling({ limit, seed: async () => seeded, seedWarned, now: () => clock.now });
    return { c, clock };
  }

  it('is due once the day\'s count reaches 80%, and not before', async () => {
    const { c } = warned(10);
    await c.take('k', 7);
    expect(c.claimWarning('k')).toBeNull();
    await c.take('k', 1);
    expect(c.claimWarning('k')).toEqual({ day: '2026-11-17', used: 8, limit: 10 });
  });

  it('is claimed once a day: a second claim gets nothing, a new day starts again', async () => {
    const { c, clock } = warned(10);
    await c.take('k', 9);
    expect(c.claimWarning('k')).not.toBeNull();
    await c.take('k', 1);
    expect(c.claimWarning('k')).toBeNull();
    clock.now = new Date('2026-11-18T00:00:01Z');
    await c.take('k', 8);
    expect(c.claimWarning('k')).toEqual({ day: '2026-11-18', used: 8, limit: 10 });
  });

  it('is claimed again after a write that failed is released', async () => {
    const { c } = warned(10);
    await c.take('k', 9);
    const claimed = c.claimWarning('k');
    expect(claimed).not.toBeNull();
    c.releaseWarning('k', claimed!);
    expect(c.claimWarning('k')).toEqual({ day: '2026-11-17', used: 9, limit: 10 });
  });

  it('remembers a warning already written today, across a restart', async () => {
    const { c } = warned(10, 9, true);
    await c.take('k', 0);
    expect(c.claimWarning('k')).toBeNull();
  });

  it('is due when the day starts past 80% from the audit log', async () => {
    const { c } = warned(10, 9, false);
    await c.take('k', 0);
    expect(c.claimWarning('k')).toEqual({ day: '2026-11-17', used: 9, limit: 10 });
  });

  it('counts the day and owes the warning when whether it was sent cannot be read', async () => {
    const { c } = warned(10, 9, new Error('events unreadable'));
    expect(await c.take('k', 0)).not.toBeNull();
    expect(c.claimWarning('k')).toEqual({ day: '2026-11-17', used: 9, limit: 10 });
  });

  it('does not let a failed write from yesterday reopen today\'s warning', async () => {
    const { c, clock } = warned(10);
    await c.take('k', 9);
    const yesterday = c.claimWarning('k');
    clock.now = new Date('2026-11-18T00:00:01Z');
    await c.take('k', 9);
    expect(c.claimWarning('k')).not.toBeNull();
    c.releaseWarning('k', yesterday!);
    expect(c.claimWarning('k')).toBeNull();
  });

  it('says nothing for a key it has not seen, and releasing one changes nothing', async () => {
    const { c } = warned(10);
    expect(c.claimWarning('nobody')).toBeNull();
    c.releaseWarning('nobody', { day: '2026-11-17', used: 9, limit: 10 });
    await c.take('nobody', 9);
    expect(c.claimWarning('nobody')).toEqual({ day: '2026-11-17', used: 9, limit: 10 });
  });
});
