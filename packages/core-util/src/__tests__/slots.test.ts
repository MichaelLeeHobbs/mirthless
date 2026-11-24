import { describe, it, expect } from 'vitest';
import { createSlots } from '../slots.js';

interface Held {
  readonly name: string;
  readonly settle: (error?: Error) => void;
}

/** Work that runs until told to settle, in the order it was started. */
function startHeld(withSlot: <T>(work: () => Promise<T>) => Promise<T>, started: Held[], name: string): Promise<string> {
  return withSlot(() => new Promise<string>((resolve, reject) => {
    started.push({ name, settle: (error) => { if (error) reject(error); else resolve(name); } });
  }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('createSlots', () => {
  it('runs at most the given number at once, and starts the rest in the order they came', async () => {
    const started: Held[] = [];
    const withSlot = createSlots(2);
    const all = ['a', 'b', 'c', 'd', 'e'].map((name) => startHeld(withSlot, started, name));
    await flush();
    expect(started.map((held) => held.name)).toEqual(['a', 'b']);

    started[1]?.settle();
    await flush();
    expect(started.map((held) => held.name)).toEqual(['a', 'b', 'c']);

    for (const i of [0, 2, 3, 4]) {
      started[i]?.settle();
      await flush();
    }
    expect(started.map((held) => held.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await Promise.all(all)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('gives a freed slot to the one that waited, not to a newcomer', async () => {
    const started: Held[] = [];
    const withSlot = createSlots(1);
    const first = startHeld(withSlot, started, 'first');
    const second = startHeld(withSlot, started, 'second');
    await flush();

    started[0]?.settle();
    const third = startHeld(withSlot, started, 'third');
    await flush();
    expect(started.map((held) => held.name)).toEqual(['first', 'second']);

    started[1]?.settle();
    await flush();
    started[2]?.settle();
    expect(await Promise.all([first, second, third])).toEqual(['first', 'second', 'third']);
  });

  it('frees the slot of work that rejects or throws, and passes the error on', async () => {
    const started: Held[] = [];
    const withSlot = createSlots(1);
    const rejected = startHeld(withSlot, started, 'rejects');
    const threw = withSlot((): Promise<string> => { throw new Error('threw'); });
    const last = startHeld(withSlot, started, 'last');
    await flush();

    started[0]?.settle(new Error('rejected'));
    await expect(rejected).rejects.toThrow('rejected');
    await expect(threw).rejects.toThrow('threw');
    started[1]?.settle();
    expect(await last).toBe('last');
  });

  it('keeps its own count for each set of slots', async () => {
    const started: Held[] = [];
    const one = startHeld(createSlots(1), started, 'one');
    const other = startHeld(createSlots(1), started, 'other');
    await flush();

    expect(started.map((held) => held.name)).toEqual(['one', 'other']);
    for (const held of started) held.settle();
    await Promise.all([one, other]);
  });
});
