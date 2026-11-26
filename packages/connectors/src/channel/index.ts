export { ChannelReceiver, type ChannelReceiverConfig } from './channel-receiver.js';
export { ChannelDispatcher, resolveTarget, type ChannelDispatcherConfig } from './channel-dispatcher.js';
export {
  registerChannel,
  unregisterChannel,
  getChannelDispatcher,
  hasChannel,
  getRegisteredChannelIds,
  clearChannelRegistry,
  type ChannelDispatchCallback,
} from './channel-registry.js';
