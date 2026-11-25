import type { ChannelRuntime } from '@galvanigraph/engine';

/** Why the channel takes no message now, or null. One that a stop or a halt is ending still reads STARTED. */
export function whyNotTaking(runtime: Pick<ChannelRuntime, 'getState' | 'runSignal'>): string | null {
  const state = runtime.getState();
  if (state !== 'STARTED') return state;
  return runtime.runSignal.aborted ? 'stopping' : null;
}
