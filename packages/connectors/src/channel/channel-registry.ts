// ===========================================
// Channel Connector Registry
// ===========================================
// Static registry mapping channelIds to their source dispatch callbacks.
// Enables in-memory inter-channel message routing.

import type { RawMessage } from '../base.js';
import type { Result } from '@mirthless/core-util';

/** Callback for dispatching a message into a channel's source pipeline. */
export type ChannelDispatchCallback = (raw: RawMessage) => Promise<Result<{ messageId: number; response?: string }>>;

/** Static registry of channel dispatch callbacks. */
const registry = new Map<string, ChannelDispatchCallback>();

/** Register a channel's dispatch callback. */
export function registerChannel(channelId: string, callback: ChannelDispatchCallback): void {
  registry.set(channelId, callback);
}

/** Unregister a channel's dispatch callback. */
export function unregisterChannel(channelId: string): void {
  registry.delete(channelId);
}

/** Get a channel's dispatch callback. */
export function getChannelDispatcher(channelId: string): ChannelDispatchCallback | undefined {
  return registry.get(channelId);
}

/** Check if a channel is registered. */
export function hasChannel(channelId: string): boolean {
  return registry.has(channelId);
}

/** Get all registered channel IDs. */
export function getRegisteredChannelIds(): readonly string[] {
  return [...registry.keys()];
}

/** Clear all registrations (for testing). */
export function clearChannelRegistry(): void {
  registry.clear();
}
