// ===========================================
// @mirthless/connectors
// ===========================================
// Protocol adapters: TCP/MLLP, HTTP, File, Database, DICOM, FHIR, SMTP, JavaScript.

export type {
  ConnectorLifecycle,
  SourceConnectorRuntime,
  DestinationConnectorRuntime,
  MessageDispatcher,
  RawMessage,
  DispatchResult,
  ConnectorMessage,
  ConnectorResponse,
} from './base.js';

export { wrapMllp, MllpParser } from './transmission/mllp-mode.js';
export { TcpMllpReceiver, type TcpMllpReceiverConfig } from './tcp-mllp/tcp-mllp-receiver.js';
export { TcpMllpDispatcher, type TcpMllpDispatcherConfig } from './tcp-mllp/tcp-mllp-dispatcher.js';
export { HttpReceiver, type HttpReceiverConfig } from './http/http-receiver.js';
export { HttpDispatcher, type HttpDispatcherConfig } from './http/http-dispatcher.js';
export { createSourceConnector, createDestinationConnector } from './registry.js';
