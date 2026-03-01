// ===========================================
// @mirthless/engine
// ===========================================
// Message processing engine: channel runtime, routing, queuing, sandbox.

export * from './sandbox/index.js';
export { MessageProcessor } from './pipeline/message-processor.js';
export type {
  ChannelScripts,
  DestinationScripts,
  DestinationConfig,
  SendToDestination,
  DestinationResponse,
  MessageStore,
  PipelineInput,
  ProcessedMessage,
  DestinationResult,
  PipelineConfig,
} from './pipeline/message-processor.js';
export { ChannelRuntime } from './runtime/channel-runtime.js';
export type {
  RuntimeConnector,
  RuntimeSourceConnector,
  ChannelRuntimeConfig,
} from './runtime/channel-runtime.js';
export { QueueConsumer } from './runtime/queue-consumer.js';
export type { QueueConsumerConfig } from './runtime/queue-consumer.js';
export { GlobalChannelMap } from './runtime/global-channel-map.js';
export { DestinationSet, createDestinationSetProxy } from './pipeline/destination-set.js';
