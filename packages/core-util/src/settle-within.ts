/** Waits for the work to end either way, for the time, or for the signal. True when the work ended. */
export function settleWithin(work: Promise<unknown>, ms: number, signal?: AbortSignal): Promise<boolean> {
  return settle(work, ms, signal);
}

/** As {@link settleWithin}, however long it takes. */
export function settleUnlessAborted(work: Promise<unknown>, signal: AbortSignal): Promise<boolean> {
  return settle(work, undefined, signal);
}

async function settle(work: Promise<unknown>, ms: number | undefined, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let giveUp = (): void => undefined;
  const givenUp = new Promise<boolean>((resolve) => {
    giveUp = (): void => { resolve(false); };
    if (ms !== undefined) timer = setTimeout(giveUp, ms);
    signal?.addEventListener('abort', giveUp);
  });
  const ended = await Promise.race([work.then(() => true, () => true), givenUp]);
  clearTimeout(timer);
  signal?.removeEventListener('abort', giveUp);
  return ended;
}
