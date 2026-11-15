// ===========================================
// Connector Registry
// ===========================================
// Maps connector types to factory functions. The keys are typed by the
// core-models connector lists, so a type the lists don't name is a compile error.

import type { SourceConnectorType, DestinationConnectorType } from '@galvaniflow/core-models';
import type { SourceConnectorRuntime, DestinationConnectorRuntime } from './base.js';
import { TcpMllpReceiver } from './tcp-mllp/tcp-mllp-receiver.js';
import { TcpMllpDispatcher } from './tcp-mllp/tcp-mllp-dispatcher.js';
import { HttpReceiver, DEFAULT_MAX_BODY_BYTES, type HttpAuthConfig } from './http/http-receiver.js';
import { framingFromHex, type Framing } from './transmission/mllp-mode.js';
import { readTlsServerOptions, readTlsClientOptions } from './tls.js';
import { HttpDispatcher } from './http/http-dispatcher.js';
import { FileReceiver, FILE_SORT_BY, FILE_POST_ACTION, type FileSortBy, type FilePostAction } from './file/file-receiver.js';
import { FileDispatcher } from './file/file-dispatcher.js';
import { DatabaseReceiver, UPDATE_MODE, ROW_FORMAT, type UpdateMode, type RowFormat } from './database/database-receiver.js';
import { DatabaseDispatcher } from './database/database-dispatcher.js';
import { DATABASE_VENDOR, type DatabaseVendor } from './database/database-vendor.js';
import { JavaScriptReceiver } from './javascript/javascript-receiver.js';
import { JavaScriptDispatcher } from './javascript/javascript-dispatcher.js';
import { SmtpDispatcher, type SmtpAttachment } from './smtp/smtp-dispatcher.js';
import { ChannelReceiver } from './channel/channel-receiver.js';
import { ChannelDispatcher } from './channel/channel-dispatcher.js';
import { FhirDispatcher, FHIR_AUTH_TYPE } from './fhir/fhir-dispatcher.js';
import { DicomReceiver } from './dicom/dicom-receiver.js';
import { DicomDispatcher } from './dicom/dicom-dispatcher.js';
import { EmailReceiver, EMAIL_POST_ACTION, type EmailPostAction, type EmailProtocol } from './email/email-receiver.js';
import { SftpReceiver, SFTP_POST_ACTION, type SftpPostAction } from './sftp/sftp-receiver.js';
import { SftpDispatcher } from './sftp/sftp-dispatcher.js';
import { KafkaReceiver } from './kafka/kafka-receiver.js';
import { KafkaDispatcher } from './kafka/kafka-dispatcher.js';
import { AmqpReceiver } from './amqp/amqp-receiver.js';
import { AmqpDispatcher } from './amqp/amqp-dispatcher.js';
import type { TlsClientOptions, TlsServerOptions } from './tls.js';
import {
  kafkaSourcePropertiesSchema,
  kafkaDestinationPropertiesSchema,
  amqpSourcePropertiesSchema,
  amqpDestinationPropertiesSchema,
  tcpMllpSourcePropertiesSchema,
  tcpMllpDestinationPropertiesSchema,
  formatPropertyIssues,
} from '@galvaniflow/core-models';

/** A plain decimal number as text: optional sign, digits with an optional dot and fraction, or a dot and fraction. */
const DECIMAL_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * A config property as a finite number, or `fallback`. A plain decimal string
 * (trimmed) is read too, because a `${name}` configuration map reference
 * resolves to text at deploy (`"6661"` for a port). Anything else falls back:
 * blank text, booleans, hex or exponent text, NaN and Infinity.
 */
export function num(props: Record<string, unknown>, key: string, fallback: number): number {
  const v = props[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string' && DECIMAL_TEXT.test(v.trim())) return Number(v);
  return fallback;
}

/** A database connector's vendor and port, the port defaulting to the vendor's own. */
export function databaseTarget(props: Record<string, unknown>): { vendor: DatabaseVendor; port: number } {
  const vendor = (props['vendor'] as DatabaseVendor | undefined) ?? DATABASE_VENDOR.POSTGRESQL;
  return { vendor, port: num(props, 'port', vendor === DATABASE_VENDOR.MYSQL ? 3306 : 5432) };
}

/**
 * Read config-driven SMTP attachments from a raw prop bag. Tolerates malformed
 * input from a UI/JSON config: non-array values yield `[]`, and any entry missing
 * a string `filename`/`content` is skipped rather than propagating a bad shape
 * into the dispatcher. `mimeType` is optional and only carried when a string.
 */
export function readSmtpAttachments(value: unknown): readonly SmtpAttachment[] {
  if (!Array.isArray(value)) return [];
  const result: SmtpAttachment[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const filename = rec['filename'];
    const content = rec['content'];
    if (typeof filename !== 'string' || typeof content !== 'string') continue;
    const mimeType = rec['mimeType'];
    result.push({ filename, content, ...(typeof mimeType === 'string' ? { mimeType } : {}) });
  }
  return result;
}

/**
 * TCP frame bytes from `frameStart` / `frameEnd` hex strings (e.g. "02" and
 * "03" for STX/ETX); undefined (MLLP) when neither is set. Invalid hex throws,
 * so the channel fails to deploy instead of misreading its partner.
 */
export function readFraming(props: Record<string, unknown>): Framing | undefined {
  const start = props['frameStart'];
  const end = props['frameEnd'];
  if (typeof start !== 'string' && typeof end !== 'string') return undefined;
  return framingFromHex(typeof start === 'string' ? start : undefined, typeof end === 'string' ? end : undefined);
}

/** A name-to-text map from a prop bag, keeping only string values; undefined when absent. */
export function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') result[k] = v;
  return result;
}

/** HTTP Basic credentials from a prop bag; undefined unless both are strings and a username is set. */
export function readBasicAuth(value: unknown): { username: string; password: string } | undefined {
  const rec = readStringRecord(value);
  return rec?.['username'] && typeof rec['password'] === 'string' ? { username: rec['username'], password: rec['password'] } : undefined;
}

/**
 * Client TLS for the Kafka and AMQP connectors: PEM material when `useTls` is
 * on (the server has already swapped certificate ids for PEM), else none.
 */
export function readQueueTls(props: Record<string, unknown>): TlsClientOptions | undefined {
  return props['useTls'] === true ? readTlsClientOptions(props) ?? {} : undefined;
}

/**
 * Server TLS for the HTTP source. On scheme HTTPS the server has swapped the
 * certificate ids for PEM, which must be complete. On any other scheme the
 * stored `tls` bag holds only certificate ids (the form keeps it when HTTPS is
 * off), so the listener is plaintext; a bag carrying cert or key PEM there
 * throws rather than being ignored.
 */
export function readHttpSourceTls(props: Record<string, unknown>): TlsServerOptions | undefined {
  if (props['scheme'] !== 'HTTPS') {
    const bag = readStringRecord(props['tls']);
    if (bag?.['cert'] || bag?.['key']) throw new Error('TLS configuration is invalid: tls has a certificate but scheme is not HTTPS');
    return undefined;
  }
  const tls = readTlsServerOptions(props);
  if (!tls) throw new Error('TLS configuration is incomplete: scheme is HTTPS but no tls cert and key are set');
  return tls;
}

/**
 * Parse props with a connector's core-models schema, throwing one readable
 * error (`TCP_MLLP properties are invalid: charset: ...`) so the channel fails
 * to deploy instead of building from a value the schema refuses.
 */
function parseProps<T>(
  type: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } } },
  props: Record<string, unknown>,
): T {
  const parsed = schema.safeParse(props);
  if (!parsed.success) throw new Error(`${type} properties are invalid: ${formatPropertyIssues(parsed.error.issues)}`);
  return parsed.data;
}

/** A TCP/MLLP source: schema-checked props, TLS read from its PEM bag. */
function tcpMllpReceiver(props: Record<string, unknown>): TcpMllpReceiver {
  const { frameStart, frameEnd, tls, processBatch: _processBatch, ...config } = parseProps('TCP_MLLP', tcpMllpSourcePropertiesSchema, props);
  return new TcpMllpReceiver({ ...config, tls: readTlsServerOptions({ tls }), framing: readFraming({ frameStart, frameEnd }) });
}

/** A TCP/MLLP destination: schema-checked props, TLS read from its PEM bag. */
function tcpMllpDispatcher(props: Record<string, unknown>): TcpMllpDispatcher {
  const { frameStart, frameEnd, tls, template: _template, ...config } = parseProps('TCP_MLLP', tcpMllpDestinationPropertiesSchema, props);
  return new TcpMllpDispatcher({ ...config, tls: readTlsClientOptions({ tls }), framing: readFraming({ frameStart, frameEnd }) });
}

/** Parse queue props with {@link parseProps}, leaving `tls` (PEM by now, not the stored ids) to {@link readQueueTls}. */
function parseQueueProps<T>(type: string, schema: Parameters<typeof parseProps<T>>[1], props: Record<string, unknown>): T & { tls: TlsClientOptions | undefined } {
  const { tls: _tls, ...rest } = props;
  return { ...parseProps(type, schema, rest), tls: readQueueTls(props) };
}

// ----- Source Factories -----

type SourceFactory = (properties: Record<string, unknown>) => SourceConnectorRuntime;

const sourceFactories: ReadonlyMap<string, SourceFactory> = new Map<SourceConnectorType, SourceFactory>([
  ['TCP_MLLP', tcpMllpReceiver],
  ['HTTP', (props): SourceConnectorRuntime => new HttpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: num(props, 'port', 0),
    path: (props['path'] as string | undefined) ?? '/',
    matchSubpaths: props['matchSubpaths'] === true,
    method: (props['method'] as string | undefined) ?? 'POST',
    responseContentType: (props['responseContentType'] as string | undefined) ?? 'text/plain',
    responseStatusCode: num(props, 'responseStatusCode', 200),
    errorStatusCode: num(props, 'errorStatusCode', 500),
    maxBodyBytes: num(props, 'maxBodyBytes', DEFAULT_MAX_BODY_BYTES),
    auth: props['auth'] as HttpAuthConfig | undefined,
    tls: readHttpSourceTls(props),
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
    ...databaseTarget(props),
    database: props['database'] as string,
    username: props['username'] as string,
    password: props['password'] as string,
    selectQuery: props['selectQuery'] as string,
    updateQuery: (props['updateQuery'] as string | undefined) ?? '',
    updateMode: (props['updateMode'] as UpdateMode | undefined) ?? UPDATE_MODE.NEVER,
    pollingIntervalMs: num(props, 'pollingIntervalMs', 5_000),
    rowFormat: (props['rowFormat'] as RowFormat | undefined) ?? ROW_FORMAT.JSON,
    tls: props['tls'] === true,
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
    aeTitle: (props['aeTitle'] as string | undefined) ?? 'GALVANIFLOW',
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
    charset: (props['charset'] as string | undefined) ?? 'utf-8',
  })],
  ['KAFKA', (props): SourceConnectorRuntime => new KafkaReceiver(parseQueueProps('KAFKA', kafkaSourcePropertiesSchema, props))],
  ['AMQP', (props): SourceConnectorRuntime => new AmqpReceiver(parseQueueProps('AMQP', amqpSourcePropertiesSchema, props))],
]);

// ----- Destination Factories -----

type DestinationFactory = (properties: Record<string, unknown>) => DestinationConnectorRuntime;

const destinationFactories: ReadonlyMap<string, DestinationFactory> = new Map<DestinationConnectorType, DestinationFactory>([
  ['TCP_MLLP', tcpMllpDispatcher],
  ['HTTP', (props): DestinationConnectorRuntime => new HttpDispatcher({
    url: props['url'] as string,
    method: (props['method'] as string | undefined) ?? 'POST',
    headers: (props['headers'] as Record<string, string> | undefined) ?? {},
    parameters: readStringRecord(props['parameters']),
    basicAuth: readBasicAuth(props['basicAuth']),
    contentType: (props['contentType'] as string | undefined) ?? 'text/plain',
    responseTimeout: num(props, 'responseTimeout', 30_000),
    scheme: props['scheme'] as string | undefined,
    tls: readTlsClientOptions(props),
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
    ...databaseTarget(props),
    database: props['database'] as string,
    username: props['username'] as string,
    password: props['password'] as string,
    query: props['query'] as string,
    useTransaction: (props['useTransaction'] as boolean | undefined) ?? false,
    returnGeneratedKeys: (props['returnGeneratedKeys'] as boolean | undefined) ?? false,
    tls: props['tls'] === true,
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
    attachments: readSmtpAttachments(props['attachments']),
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
    callingAETitle: (props['callingAETitle'] as string | undefined) ?? 'GALVANIFLOW',
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
  ['KAFKA', (props): DestinationConnectorRuntime => new KafkaDispatcher(parseQueueProps('KAFKA', kafkaDestinationPropertiesSchema, props))],
  ['AMQP', (props): DestinationConnectorRuntime => new AmqpDispatcher(parseQueueProps('AMQP', amqpDestinationPropertiesSchema, props))],
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
