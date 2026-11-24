/** At most `max` pieces of work run at once; the rest start in the order they came. */
export function createSlots(max: number): <T>(work: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: Array<() => void> = [];

  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running < max) {
      running += 1;
    } else {
      await new Promise<void>((resolve) => { waiting.push(resolve); });
    }
    try {
      return await work();
    } finally {
      // Hand the slot straight to the next caller, so no newcomer can slip in between.
      const next = waiting.shift();
      if (next) next(); else running -= 1;
    }
  };
}
