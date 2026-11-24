/** Waits for the work to end either way, or for the time. True when it ended. */
export async function settleWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => { resolve(false); }, ms); });
  const ended = await Promise.race([work.then(() => true, () => true), timeout]);
  clearTimeout(timer);
  return ended;
}
