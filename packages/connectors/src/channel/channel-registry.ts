import type { RawMessage, DispatchResult } from '../base.js';
import type { Result } from '@galvanigraph/core-util';

export type ChannelDispatchCallback = (raw: RawMessage) => Promise<Result<DispatchResult>>;

const registry = new Map<string, ChannelDispatchCallback>();

export function registerChannel(channelId: string, callback: ChannelDispatchCallback): void {
  registry.set(channelId, callback);
}

export function unregisterChannel(channelId: string): void {
  registry.delete(channelId);
}

export function getChannelDispatcher(channelId: string): ChannelDispatchCallback | undefined {
  return registry.get(channelId);
}

export function hasChannel(channelId: string): boolean {
  return registry.has(channelId);
}

export function getRegisteredChannelIds(): readonly string[] {
  return [...registry.keys()];
}

/** For tests. */
export function clearChannelRegistry(): void {
  registry.clear();
}
