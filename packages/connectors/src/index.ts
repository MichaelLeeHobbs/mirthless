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
export {
  FileReceiver,
  FileDispatcher,
  matchGlob,
  resolveOutputFilename,
  FILE_SORT_BY,
  FILE_POST_ACTION,
  type FileReceiverConfig,
  type FileDispatcherConfig,
  type FileSortBy,
  type FilePostAction,
} from './file/index.js';
export {
  prepare,
  ConnectionPool,
  DatabaseReceiver,
  DatabaseDispatcher,
  UPDATE_MODE,
  ROW_FORMAT,
  type PreparedQuery,
  type PoolConfig,
  type QueryResult,
  type DatabaseReceiverConfig,
  type DatabaseDispatcherConfig,
  type UpdateMode,
  type RowFormat,
} from './database/index.js';
export { createSourceConnector, createDestinationConnector } from './registry.js';
