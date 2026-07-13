// ===========================================
// Connector Registry
// ===========================================
// Maps connector types to factory functions.

import type { SourceConnectorRuntime, DestinationConnectorRuntime } from './base.js';
import { TcpMllpReceiver, MLLP_RESPONSE_MODE, type MllpResponseMode } from './tcp-mllp/tcp-mllp-receiver.js';
import { TcpMllpDispatcher } from './tcp-mllp/tcp-mllp-dispatcher.js';
import { HttpReceiver, DEFAULT_MAX_BODY_BYTES, type HttpAuthConfig } from './http/http-receiver.js';
import { DEFAULT_MAX_FRAME_BYTES } from './transmission/mllp-mode.js';
import { readTlsServerOptions, readTlsClientOptions } from './tls.js';
import { HttpDispatcher } from './http/http-dispatcher.js';
import { FileReceiver, FILE_SORT_BY, FILE_POST_ACTION, type FileSortBy, type FilePostAction } from './file/file-receiver.js';
import { FileDispatcher } from './file/file-dispatcher.js';
import { DatabaseReceiver, UPDATE_MODE, ROW_FORMAT, type UpdateMode, type RowFormat } from './database/database-receiver.js';
import { DatabaseDispatcher } from './database/database-dispatcher.js';
import { JavaScriptReceiver } from './javascript/javascript-receiver.js';
import { JavaScriptDispatcher } from './javascript/javascript-dispatcher.js';
import { SmtpDispatcher } from './smtp/smtp-dispatcher.js';
import { ChannelReceiver } from './channel/channel-receiver.js';
import { ChannelDispatcher } from './channel/channel-dispatcher.js';
import { FhirDispatcher, FHIR_AUTH_TYPE } from './fhir/fhir-dispatcher.js';
import { DicomReceiver } from './dicom/dicom-receiver.js';
import { DicomDispatcher } from './dicom/dicom-dispatcher.js';
import { EmailReceiver, EMAIL_POST_ACTION, type EmailPostAction, type EmailProtocol } from './email/email-receiver.js';
import { SftpReceiver, SFTP_POST_ACTION, type SftpPostAction } from './sftp/sftp-receiver.js';
import { SftpDispatcher } from './sftp/sftp-dispatcher.js';

/**
 * Coerce a config property to a finite number, tolerating string values (a UI/JSON
 * config can deliver `"6661"` for a port). Returns the fallback for missing/empty/
 * non-numeric values so a bad type never masquerades as a number and later breaks
 * arithmetic/comparisons or throws deep inside a connector.
 */
export function num(props: Record<string, unknown>, key: string, fallback: number): number {
  const v = props[key];
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ----- Source Factories -----

type SourceFactory = (properties: Record<string, unknown>) => SourceConnectorRuntime;

const sourceFactories = new Map<string, SourceFactory>([
  ['TCP_MLLP', (props): SourceConnectorRuntime => new TcpMllpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: num(props, 'port', 0),
    maxConnections: num(props, 'maxConnections', 10),
    responseMode: (props['responseMode'] as MllpResponseMode | undefined) ?? MLLP_RESPONSE_MODE.AUTO_ACK,
    charset: (props['charset'] as BufferEncoding | undefined) ?? 'utf-8',
    maxFrameBytes: num(props, 'maxFrameBytes', DEFAULT_MAX_FRAME_BYTES),
    tls: readTlsServerOptions(props),
  })],
  ['HTTP', (props): SourceConnectorRuntime => new HttpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: num(props, 'port', 0),
    path: (props['path'] as string | undefined) ?? '/',
    method: (props['method'] as string | undefined) ?? 'POST',
    responseContentType: (props['responseContentType'] as string | undefined) ?? 'text/plain',
    responseStatusCode: num(props, 'responseStatusCode', 200),
    errorStatusCode: num(props, 'errorStatusCode', 500),
    maxBodyBytes: num(props, 'maxBodyBytes', DEFAULT_MAX_BODY_BYTES),
    auth: props['auth'] as HttpAuthConfig | undefined,
    tls: readTlsServerOptions(props),
  })],
  ['FILE', (props): SourceConnectorRuntime => new FileReceiver({
    directory: props['directory'] as string,
    fileFilter: (props['fileFilter'] as string | undefined) ?? '*',
    pollingIntervalMs: num(props, 'pollingIntervalMs', 5_000),
    sortBy: (props['sortBy'] as FileSortBy | undefined) ?? FILE_SORT_BY.NAME,
    charset: (props['charset'] as BufferEncoding | undefined) ?? 'utf-8',
    binary: (props['binary'] as boolean | undefined) ?? false,
    checkFileAge: (props['checkFileAge'] as boolean | undefined) ?? true,
    fileAgeMs: num(props, 'fileAgeMs', 1_000),
    postAction: (props['postAction'] as FilePostAction | undefined) ?? FILE_POST_ACTION.DELETE,
    moveToDirectory: (props['moveToDirectory'] as string | undefined) ?? '',
  })],
  ['DATABASE', (props): SourceConnectorRuntime => new DatabaseReceiver({
    host: props['host'] as string,
    port: num(props, 'port', 5432),
    database: props['database'] as string,
    username: props['username'] as string,
    password: props['password'] as string,
    selectQuery: props['selectQuery'] as string,
    updateQuery: (props['updateQuery'] as string | undefined) ?? '',
    updateMode: (props['updateMode'] as UpdateMode | undefined) ?? UPDATE_MODE.NEVER,
    pollingIntervalMs: num(props, 'pollingIntervalMs', 5_000),
    rowFormat: (props['rowFormat'] as RowFormat | undefined) ?? ROW_FORMAT.JSON,
  })],
  ['JAVASCRIPT', (props): SourceConnectorRuntime => new JavaScriptReceiver({
    script: (props['script'] as string | undefined) ?? '',
    pollingIntervalMs: num(props, 'pollingIntervalMs', 5_000),
  })],
  ['CHANNEL', (props): SourceConnectorRuntime => new ChannelReceiver({
    channelId: props['channelId'] as string,
  })],
  ['DICOM', (props): SourceConnectorRuntime => new DicomReceiver({
    port: num(props, 'port', 0),
    storageDir: props['storageDir'] as string,
    aeTitle: (props['aeTitle'] as string | undefined) ?? 'MIRTHLESS',
    minPoolSize: num(props, 'minPoolSize', 2),
    maxPoolSize: num(props, 'maxPoolSize', 10),
    connectionTimeoutMs: num(props, 'connectionTimeoutMs', 10_000),
    dispatchMode: (props['dispatchMode'] as 'PER_FILE' | 'PER_ASSOCIATION' | undefined) ?? 'PER_FILE',
    postAction: (props['postAction'] as 'DELETE' | 'MOVE' | 'NONE' | undefined) ?? 'DELETE',
    moveToDirectory: (props['moveToDirectory'] as string | undefined) ?? '',
  })],
  ['EMAIL', (props): SourceConnectorRuntime => new EmailReceiver({
    host: props['host'] as string,
    port: num(props, 'port', 993),
    secure: (props['secure'] as boolean | undefined) ?? true,
    username: (props['username'] as string | undefined) ?? '',
    password: (props['password'] as string | undefined) ?? '',
    protocol: (props['protocol'] as EmailProtocol | undefined) ?? 'IMAP',
    folder: (props['folder'] as string | undefined) ?? 'INBOX',
    pollingIntervalMs: num(props, 'pollingIntervalMs', 60_000),
    postAction: (props['postAction'] as EmailPostAction | undefined) ?? EMAIL_POST_ACTION.MARK_READ,
    moveToFolder: (props['moveToFolder'] as string | undefined) ?? '',
    subjectFilter: (props['subjectFilter'] as string | undefined) ?? '',
    includeAttachments: (props['includeAttachments'] as boolean | undefined) ?? false,
  })],
  ['SFTP', (props): SourceConnectorRuntime => new SftpReceiver({
    host: props['host'] as string,
    port: num(props, 'port', 22),
    username: props['username'] as string,
    password: props['password'] as string | undefined,
    privateKey: props['privateKey'] as string | undefined,
    passphrase: props['passphrase'] as string | undefined,
    remoteDirectory: props['remoteDirectory'] as string,
    filePattern: (props['filePattern'] as string | undefined) ?? '*',
    pollingIntervalMs: num(props, 'pollingIntervalMs', 5_000),
    afterProcessing: (props['afterProcessing'] as SftpPostAction | undefined) ?? SFTP_POST_ACTION.DELETE,
    moveToDirectory: (props['moveToDirectory'] as string | undefined) ?? '',
    minFileAgeMs: num(props, 'minFileAgeMs', 1_000),
    strictHostKey: (props['strictHostKey'] as boolean | undefined) ?? true,
    hostKey: props['hostKey'] as string | undefined,
  })],
]);

// ----- Destination Factories -----

type DestinationFactory = (properties: Record<string, unknown>) => DestinationConnectorRuntime;

const destinationFactories = new Map<string, DestinationFactory>([
  ['TCP_MLLP', (props): DestinationConnectorRuntime => new TcpMllpDispatcher({
    host: props['host'] as string,
    port: num(props, 'port', 0),
    maxConnections: num(props, 'maxConnections', 5),
    responseTimeout: num(props, 'responseTimeout', 30_000),
    acquireTimeoutMs: num(props, 'acquireTimeoutMs', 30_000),
    charset: (props['charset'] as BufferEncoding | undefined) ?? 'utf-8',
    tls: readTlsClientOptions(props),
  })],
  ['HTTP', (props): DestinationConnectorRuntime => new HttpDispatcher({
    url: props['url'] as string,
    method: (props['method'] as string | undefined) ?? 'POST',
    headers: (props['headers'] as Record<string, string> | undefined) ?? {},
    contentType: (props['contentType'] as string | undefined) ?? 'text/plain',
    responseTimeout: num(props, 'responseTimeout', 30_000),
  })],
  ['FILE', (props): DestinationConnectorRuntime => new FileDispatcher({
    directory: props['directory'] as string,
    outputPattern: (props['outputPattern'] as string | undefined) ?? '${messageId}.txt',
    charset: (props['charset'] as BufferEncoding | undefined) ?? 'utf-8',
    binary: (props['binary'] as boolean | undefined) ?? false,
    tempFileEnabled: (props['tempFileEnabled'] as boolean | undefined) ?? true,
    appendMode: (props['appendMode'] as boolean | undefined) ?? false,
  })],
  ['DATABASE', (props): DestinationConnectorRuntime => new DatabaseDispatcher({
    host: props['host'] as string,
    port: num(props, 'port', 5432),
    database: props['database'] as string,
    username: props['username'] as string,
    password: props['password'] as string,
    query: props['query'] as string,
    useTransaction: (props['useTransaction'] as boolean | undefined) ?? false,
    returnGeneratedKeys: (props['returnGeneratedKeys'] as boolean | undefined) ?? false,
  })],
  ['JAVASCRIPT', (props): DestinationConnectorRuntime => new JavaScriptDispatcher({
    script: (props['script'] as string | undefined) ?? '',
  })],
  ['SMTP', (props): DestinationConnectorRuntime => new SmtpDispatcher({
    host: (props['host'] as string | undefined) ?? '',
    port: num(props, 'port', 587),
    secure: (props['secure'] as boolean | undefined) ?? false,
    requireTLS: (props['requireTLS'] as boolean | undefined) ?? false,
    // Only attach auth when a username is configured (anonymous relay otherwise).
    ...(props['authUser']
      ? { auth: { user: props['authUser'] as string, pass: (props['authPass'] as string | undefined) ?? '' } }
      : {}),
    from: (props['from'] as string | undefined) ?? '',
    to: (props['to'] as string | undefined) ?? '',
    cc: (props['cc'] as string | undefined) ?? '',
    bcc: (props['bcc'] as string | undefined) ?? '',
    subject: (props['subject'] as string | undefined) ?? '',
    bodyTemplate: (props['bodyTemplate'] as string | undefined) ?? '${msg}',
    contentType: (props['contentType'] as 'text/plain' | 'text/html' | undefined) ?? 'text/plain',
    attachContent: (props['attachContent'] as boolean | undefined) ?? false,
  })],
  ['CHANNEL', (props): DestinationConnectorRuntime => new ChannelDispatcher({
    targetChannelId: (props['targetChannelId'] as string | undefined) ?? '',
    waitForResponse: (props['waitForResponse'] as boolean | undefined) ?? false,
  })],
  ['FHIR', (props): DestinationConnectorRuntime => new FhirDispatcher({
    baseUrl: (props['baseUrl'] as string | undefined) ?? '',
    resourceType: (props['resourceType'] as string | undefined) ?? 'Patient',
    method: (props['method'] as 'POST' | 'PUT' | undefined) ?? 'POST',
    authType: (props['authType'] as 'NONE' | 'BASIC' | 'BEARER' | 'API_KEY' | undefined) ?? FHIR_AUTH_TYPE.NONE,
    authConfig: {
      username: (props['authUsername'] as string | undefined),
      password: (props['authPassword'] as string | undefined),
      token: (props['authToken'] as string | undefined),
      headerName: (props['authHeaderName'] as string | undefined),
      apiKey: (props['authApiKey'] as string | undefined),
    },
    format: (props['format'] as 'json' | 'xml' | undefined) ?? 'json',
    timeout: num(props, 'timeout', 30_000),
    headers: (props['headers'] as Record<string, string> | undefined) ?? {},
  })],
  ['DICOM', (props): DestinationConnectorRuntime => new DicomDispatcher({
    host: props['host'] as string,
    port: num(props, 'port', 0),
    calledAETitle: (props['calledAETitle'] as string | undefined) ?? 'PACS',
    callingAETitle: (props['callingAETitle'] as string | undefined) ?? 'MIRTHLESS',
    mode: (props['mode'] as 'single' | 'multiple' | undefined) ?? 'multiple',
    maxAssociations: num(props, 'maxAssociations', 4),
    maxRetries: num(props, 'maxRetries', 3),
    retryDelayMs: num(props, 'retryDelayMs', 1_000),
    timeoutMs: num(props, 'timeoutMs', 30_000),
  })],
  ['SFTP', (props): DestinationConnectorRuntime => new SftpDispatcher({
    host: props['host'] as string,
    port: num(props, 'port', 22),
    username: props['username'] as string,
    password: props['password'] as string | undefined,
    privateKey: props['privateKey'] as string | undefined,
    passphrase: props['passphrase'] as string | undefined,
    remoteDirectory: props['remoteDirectory'] as string,
    fileNameTemplate: (props['fileNameTemplate'] as string | undefined) ?? '${messageId}.dat',
    appendMode: (props['appendMode'] as boolean | undefined) ?? false,
    strictHostKey: (props['strictHostKey'] as boolean | undefined) ?? true,
    hostKey: props['hostKey'] as string | undefined,
  })],
]);

// ----- Public API -----

/** Create a source connector by type. */
export function createSourceConnector(
  connectorType: string,
  properties: Record<string, unknown>,
): SourceConnectorRuntime {
  const factory = sourceFactories.get(connectorType);
  if (!factory) {
    throw new Error(`Unknown source connector type: ${connectorType}`);
  }
  return factory(properties);
}

/** Create a destination connector by type. */
export function createDestinationConnector(
  connectorType: string,
  properties: Record<string, unknown>,
): DestinationConnectorRuntime {
  const factory = destinationFactories.get(connectorType);
  if (!factory) {
    throw new Error(`Unknown destination connector type: ${connectorType}`);
  }
  return factory(properties);
}
