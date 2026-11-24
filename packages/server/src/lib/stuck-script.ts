// What the watchdog's thread does about a stuck script.

import { errorInfo } from '@galvanigraph/core-util';
import type { ScriptWatch } from '@galvanigraph/engine/script-watch';

/** A killed process is gone long before. */
export const STILL_HERE_MS = 2_000;

export interface StuckScriptDeps {
  readonly tickMs: number;
  readonly read: () => ScriptWatch;
  /** Whether there was a deployment to hold. */
  readonly hold: (channelId: string) => Promise<boolean>;
  readonly release: (channelId: string) => Promise<void>;
  readonly kill: () => void;
  readonly log: (fields: Readonly<Record<string, unknown>>, msg: string) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
}

async function tryHold(channelId: string, deps: StuckScriptDeps): Promise<void> {
  try {
    const held = await deps.hold(channelId);
    await deps.log({ channelId, held }, held ? 'The channel stays undeployed after the restart' : 'The channel has no deployment to hold');
  } catch (err: unknown) {
    await deps.log({ channelId, held: false, ...errorInfo(err) }, 'The channel could not be held: it runs again after the restart, with any message it had not finished');
  }
}

/** Also after a hold that failed: its reply may be all that was lost. */
async function tryRelease(channelId: string, deps: StuckScriptDeps): Promise<void> {
  try {
    await deps.release(channelId);
  } catch (err: unknown) {
    await deps.log({ channelId, ...errorInfo(err) }, 'The channel runs, but a hold on it could not be removed: a restart may leave it undeployed. Deploy it to remove the hold');
  }
}

/**
 * Holds the script's channel and ends the process. Returns only when the script ended by itself
 * after all, with the hold removed again.
 */
export async function endStuckServer(stuck: ScriptWatch, deps: StuckScriptDeps): Promise<void> {
  const { channelId, limitMs } = stuck;
  const stillStuck = (): boolean => deps.read().sequence === stuck.sequence;
  await deps.log({ channelId, limitMs }, 'A script ran far past its time limit and cannot be stopped. Ending the server for its supervisor to restart');
  if (channelId !== null) await tryHold(channelId, deps);
  if (stillStuck()) {
    deps.kill();
    await deps.sleep(STILL_HERE_MS);
    if (stillStuck()) await deps.log({}, 'The server could not be ended. It is stuck: restart it. (PID 1 cannot end itself; run the container with an init process)');
    while (stillStuck()) await deps.sleep(deps.tickMs);
  }
  await deps.log({ channelId }, 'The script ended by itself after all, so the server runs on');
  if (channelId !== null) await tryRelease(channelId, deps);
}
