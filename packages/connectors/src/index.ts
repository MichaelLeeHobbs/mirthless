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
export {
  JavaScriptReceiver,
  JavaScriptDispatcher,
  normalizeScriptResult,
  type JavaScriptReceiverConfig,
  type JavaScriptDispatcherConfig,
  type ScriptRunner,
  type DestScriptRunner,
} from './javascript/index.js';
export {
  SmtpDispatcher,
  substituteTemplate,
  type SmtpDispatcherConfig,
  type SmtpAuth,
  type SmtpTransport,
  type SmtpMailOptions,
  type SmtpSendResult,
  type SmtpAttachment,
  type TransportFactory,
} from './smtp/index.js';
export {
  ChannelReceiver,
  ChannelDispatcher,
  registerChannel,
  unregisterChannel,
  getChannelDispatcher,
  hasChannel,
  getRegisteredChannelIds,
  clearChannelRegistry,
  type ChannelReceiverConfig,
  type ChannelDispatcherConfig,
  type ChannelDispatchCallback,
} from './channel/index.js';
export {
  FhirDispatcher,
  buildFhirUrl,
  buildHeaders,
  FHIR_AUTH_TYPE,
  type FhirDispatcherConfig,
  type FhirAuthConfig,
  type FhirAuthType,
} from './fhir/index.js';
export {
  DicomReceiver,
  DicomDispatcher,
  DICOM_POST_ACTION,
  DICOM_DISPATCH_MODE,
  type DicomReceiverConfig,
  type DicomDispatcherConfig,
  type DicomPostAction,
  type DicomDispatchMode,
  type DcmtkReceiver,
  type DcmtkSender,
  type DcmtkSendResult,
  type DcmtkFileData,
  type DcmtkAssociationData,
  type ReceiverFactory,
  type SenderFactory,
} from './dicom/index.js';
export {
  EmailReceiver,
  EMAIL_PROTOCOL,
  EMAIL_POST_ACTION,
  type EmailReceiverConfig,
  type EmailProtocol,
  type EmailPostAction,
  type EmailMessage,
  type ImapClient,
  type ImapClientFactory,
} from './email/index.js';
export { createSourceConnector, createDestinationConnector } from './registry.js';
