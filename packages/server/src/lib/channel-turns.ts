/** The deploy, undeploy, redeploy, delete or purge of each channel in progress, as the tail of a queue. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Run `fn` once every earlier one of the same channel has finished, so the running channel and its
 * deployment record change together: an undeploy cannot land between a deploy and its record, the
 * startup redeploy cannot bring back a version someone replaced meanwhile, and a channel that is
 * being deployed is not deleted.
 */
export async function inTurn<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(channelId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(channelId, tail);
  try {
    return await run;
  } finally {
    if (queues.get(channelId) === tail) queues.delete(channelId);
  }
}

/** Whether something is under way on the channel, or waits for its turn. */
export function turnUnderWay(channelId: string): boolean {
  return queues.has(channelId);
}
