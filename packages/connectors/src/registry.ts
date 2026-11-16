// ===========================================
// Connector Registry
// ===========================================
// Maps connector types to factory functions. The keys are typed by the
// core-models connector lists, so a type the lists don't name is a compile error.

import type { SourceConnectorType, DestinationConnectorType } from '@galvaniflow/core-models';
import type { SourceConnectorRuntime, DestinationConnectorRuntime } from './base.js';
import { TcpMllpReceiver } from './tcp-mllp/tcp-mllp-receiver.js';
import { TcpMllpDispatcher } from './tcp-mllp/tcp-mllp-dispatcher.js';
import { HttpReceiver } from './http/http-receiver.js';
import { framingFromHex, type Framing } from './transmission/mllp-mode.js';
import { readTlsServerOptions, readTlsClientOptions } from './tls.js';
import { HttpDispatcher } from './http/http-dispatcher.js';
import { FileReceiver } from './file/file-receiver.js';
import { FileDispatcher } from './file/file-dispatcher.js';
import { DatabaseReceiver } from './database/database-receiver.js';
import { DatabaseDispatcher } from './database/database-dispatcher.js';
import { DATABASE_VENDOR, type DatabaseVendor } from './database/database-vendor.js';
import { JavaScriptReceiver } from './javascript/javascript-receiver.js';
import { JavaScriptDispatcher } from './javascript/javascript-dispatcher.js';
import { SmtpDispatcher, type SmtpDispatcherConfig } from './smtp/smtp-dispatcher.js';
import { ChannelReceiver } from './channel/channel-receiver.js';
import { ChannelDispatcher } from './channel/channel-dispatcher.js';
import { FhirDispatcher, type FhirDispatcherConfig } from './fhir/fhir-dispatcher.js';
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
  httpSourcePropertiesSchema,
  httpDestinationPropertiesSchema,
  databaseSourcePropertiesSchema,
  databaseDestinationPropertiesSchema,
  defaultDatabasePort,
  fileSourcePropertiesSchema,
  fileDestinationPropertiesSchema,
  javascriptSourcePropertiesSchema,
  javascriptDestinationPropertiesSchema,
  channelSourcePropertiesSchema,
  channelDestinationPropertiesSchema,
  fhirDestinationPropertiesSchema,
  smtpDestinationPropertiesSchema,
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

/** A database connector's vendor (PostgreSQL when unset) and port, the port defaulting to the vendor's own. */
export function databaseTarget(props: { readonly vendor?: DatabaseVendor | undefined; readonly port?: number | undefined }): { vendor: DatabaseVendor; port: number } {
  const vendor = props.vendor ?? DATABASE_VENDOR.POSTGRESQL;
  return { vendor, port: props.port ?? defaultDatabasePort(vendor) };
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

/**
 * Parse props with {@link parseProps}, `tls` set aside: the schema checks the
 * stored certificate ids, and by now the server has swapped them for PEM,
 * which the caller reads itself.
 */
function parseWithoutTls<T>(type: string, schema: Parameters<typeof parseProps<T>>[1], props: Record<string, unknown>): T {
  const { tls: _tls, ...rest } = props;
  return parseProps(type, schema, rest);
}

/** Parse queue props with {@link parseWithoutTls}, TLS read by {@link readQueueTls}. */
function parseQueueProps<T>(type: string, schema: Parameters<typeof parseProps<T>>[1], props: Record<string, unknown>): T & { tls: TlsClientOptions | undefined } {
  return { ...parseWithoutTls(type, schema, props), tls: readQueueTls(props) };
}

/** An HTTP source: schema-checked props, TLS read from the PEM the server resolved. */
function httpReceiver(props: Record<string, unknown>): HttpReceiver {
  const { tls: _tls, scheme: _scheme, processBatch: _processBatch, ...config } = parseWithoutTls('HTTP', httpSourcePropertiesSchema, props);
  return new HttpReceiver({ ...config, tls: readHttpSourceTls(props) });
}

/** An HTTP destination: schema-checked props, TLS read from the PEM the server resolved. */
function httpDispatcher(props: Record<string, unknown>): HttpDispatcher {
  const { tls: _tls, template: _template, basicAuth, ...config } = parseWithoutTls('HTTP', httpDestinationPropertiesSchema, props);
  return new HttpDispatcher({ ...config, basicAuth: readBasicAuth(basicAuth), tls: readTlsClientOptions(props) });
}

/** A Database Reader: schema-checked props, the port defaulting to the vendor's. */
function databaseReceiver(props: Record<string, unknown>): DatabaseReceiver {
  const { vendor, port, processBatch: _processBatch, ...config } = parseProps('DATABASE', databaseSourcePropertiesSchema, props);
  return new DatabaseReceiver({ ...config, ...databaseTarget({ vendor, port }) });
}

/** A Database Writer: schema-checked props, the port defaulting to the vendor's. */
function databaseDispatcher(props: Record<string, unknown>): DatabaseDispatcher {
  const { vendor, port, template: _template, ...config } = parseProps('DATABASE', databaseDestinationPropertiesSchema, props);
  return new DatabaseDispatcher({ ...config, ...databaseTarget({ vendor, port }) });
}

/** A File Reader: schema-checked props. */
function fileReceiver(props: Record<string, unknown>): FileReceiver {
  const { processBatch: _processBatch, ...config } = parseProps('FILE', fileSourcePropertiesSchema, props);
  return new FileReceiver(config);
}

/** A File Writer: schema-checked props. */
function fileDispatcher(props: Record<string, unknown>): FileDispatcher {
  const { template: _template, ...config } = parseProps('FILE', fileDestinationPropertiesSchema, props);
  return new FileDispatcher(config);
}

/** A JavaScript Reader: schema-checked props. The engine reads the script language and compiles the script. */
function javascriptReceiver(props: Record<string, unknown>): JavaScriptReceiver {
  const { script, pollingIntervalMs } = parseProps('JAVASCRIPT', javascriptSourcePropertiesSchema, props);
  return new JavaScriptReceiver({ script, pollingIntervalMs });
}

/** A JavaScript Writer: schema-checked props. */
function javascriptDispatcher(props: Record<string, unknown>): JavaScriptDispatcher {
  const { script } = parseProps('JAVASCRIPT', javascriptDestinationPropertiesSchema, props);
  return new JavaScriptDispatcher({ script });
}

/** A Channel Reader: schema-checked props; deploy sets channelId to the channel's own id. */
function channelReceiver(props: Record<string, unknown>): ChannelReceiver {
  const { channelId } = parseProps('CHANNEL', channelSourcePropertiesSchema, props);
  return new ChannelReceiver({ channelId });
}

/** A Channel Writer: schema-checked props. */
function channelDispatcher(props: Record<string, unknown>): ChannelDispatcher {
  const { targetChannelId, waitForResponse } = parseProps('CHANNEL', channelDestinationPropertiesSchema, props);
  return new ChannelDispatcher({ targetChannelId, waitForResponse });
}

/** A FHIR destination's config from schema-checked props, the credentials grouped as the dispatcher reads them. */
export function fhirDispatcherConfig(props: Record<string, unknown>): FhirDispatcherConfig {
  const { authUsername, authPassword, authToken, authHeaderName, authApiKey, template: _template, ...config } =
    parseProps('FHIR', fhirDestinationPropertiesSchema, props);
  return {
    ...config,
    authConfig: { username: authUsername, password: authPassword, token: authToken, headerName: authHeaderName, apiKey: authApiKey },
  };
}

/** An SMTP destination's config from schema-checked props: a login only when a user is set (anonymous relay otherwise). */
export function smtpDispatcherConfig(props: Record<string, unknown>): SmtpDispatcherConfig {
  const { authUser, authPass, template: _template, ...config } = parseProps('SMTP', smtpDestinationPropertiesSchema, props);
  return { ...config, ...(authUser ? { auth: { user: authUser, pass: authPass ?? '' } } : {}) };
}

// ----- Source Factories -----

type SourceFactory = (properties: Record<string, unknown>) => SourceConnectorRuntime;

const sourceFactories: ReadonlyMap<string, SourceFactory> = new Map<SourceConnectorType, SourceFactory>([
  ['TCP_MLLP', tcpMllpReceiver],
  ['HTTP', httpReceiver],
  ['FILE', fileReceiver],
  ['DATABASE', databaseReceiver],
  ['JAVASCRIPT', javascriptReceiver],
  ['CHANNEL', channelReceiver],
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
    ignoreDot: (props['ignoreDot'] as boolean | undefined) ?? true,
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
  ['HTTP', httpDispatcher],
  ['FILE', fileDispatcher],
  ['DATABASE', databaseDispatcher],
  ['JAVASCRIPT', javascriptDispatcher],
  ['SMTP', (props): DestinationConnectorRuntime => new SmtpDispatcher(smtpDispatcherConfig(props))],
  ['CHANNEL', channelDispatcher],
  ['FHIR', (props): DestinationConnectorRuntime => new FhirDispatcher(fhirDispatcherConfig(props))],
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
