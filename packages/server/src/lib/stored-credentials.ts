// What an OVERWRITE import does with a credential its file masks (D-335): keeps
// the stored one, unless the file would send it somewhere else or use it as
// someone else.

import { isDeepStrictEqual } from 'node:util';
import {
  isDestinationConnectorType,
  isSourceConnectorType,
  withoutKeys,
  type DestinationConnectorType,
  type SourceConnectorType,
} from '@galvanigraph/core-models';
import { stripRedactedProperties } from './secret-redaction.js';

export type ConnectorDirection = 'source' | 'destination';

/**
 * Only `free` and `credentials` are read: any other key counts as deciding, so
 * one nobody has listed drops the credential. `deciding` is there so a test can
 * tell a key someone judged from a key someone forgot.
 */
export interface ConnectorKeys {
  /** Where a credential is sent (or asked for), how it is protected on the way, and whose it is. */
  readonly deciding: readonly string[];
  readonly free: readonly string[];
  readonly credentials: readonly string[];
}

// sourceCommonProperties and destinationCommonProperties in core-models.
const SOURCE_COMMON = ['processBatch'];
const DESTINATION_COMMON = ['template'];

/** No credential of its own, so nothing needs to be free. */
function withoutCredentials(...deciding: readonly string[]): ConnectorKeys {
  return { deciding, free: [], credentials: [] };
}

const DATABASE_LOGIN = { deciding: ['vendor', 'host', 'port', 'database', 'username', 'tls'], credentials: ['password'] };
const SFTP_LOGIN = { deciding: ['host', 'port', 'username', 'strictHostKey', 'hostKey'], credentials: ['password', 'privateKey', 'passphrase'] };
const KAFKA_LOGIN = { deciding: ['brokers', 'clientId', 'useTls', 'tls', 'saslMechanism', 'saslUsername'], credentials: ['saslPassword'] };
const AMQP_LOGIN = { deciding: ['host', 'port', 'vhost', 'username', 'useTls', 'tls'], credentials: ['password'] };

const SOURCE_KEYS: Readonly<Record<SourceConnectorType, ConnectorKeys>> = {
  TCP_MLLP: {
    deciding: ['host', 'port', 'tls'],
    free: ['maxConnections', 'responseMode', 'charset', 'maxFrameBytes', 'frameStart', 'frameEnd', ...SOURCE_COMMON],
    credentials: [],
  },
  HTTP: {
    deciding: ['host', 'port', 'path', 'matchSubpaths', 'auth', 'scheme', 'tls'],
    free: ['method', 'responseContentType', 'responseStatusCode', 'errorStatusCode', 'maxBodyBytes', ...SOURCE_COMMON],
    credentials: [],
  },
  FILE: withoutCredentials(
    'directory', 'fileFilter', 'ignoreDot', 'pollingIntervalMs', 'sortBy', 'charset', 'binary', 'checkFileAge', 'fileAgeMs',
    'postAction', 'moveToDirectory', ...SOURCE_COMMON,
  ),
  DATABASE: {
    ...DATABASE_LOGIN,
    free: ['selectQuery', 'updateQuery', 'updateMode', 'pollingIntervalMs', 'rowFormat', ...SOURCE_COMMON],
  },
  JAVASCRIPT: withoutCredentials('script', 'scriptLanguage', 'pollingIntervalMs', ...SOURCE_COMMON),
  CHANNEL: withoutCredentials('channelId', ...SOURCE_COMMON),
  DICOM: withoutCredentials(
    'port', 'storageDir', 'aeTitle', 'connectionTimeoutMs', 'dispatchMode', 'postAction', 'moveToDirectory', ...SOURCE_COMMON,
  ),
  EMAIL: {
    deciding: ['host', 'port', 'secure', 'username', 'protocol'],
    free: ['folder', 'pollingIntervalMs', 'postAction', 'moveToFolder', 'subjectFilter', 'includeAttachments', ...SOURCE_COMMON],
    credentials: ['password'],
  },
  SFTP: {
    ...SFTP_LOGIN,
    free: [
      'remoteDirectory', 'filePattern', 'ignoreDot', 'pollingIntervalMs', 'afterProcessing', 'moveToDirectory', 'minFileAgeMs',
      'charset', ...SOURCE_COMMON,
    ],
  },
  KAFKA: { ...KAFKA_LOGIN, free: ['topic', 'groupId', 'startFrom', 'charset', 'maxStoreAttempts', ...SOURCE_COMMON] },
  AMQP: { ...AMQP_LOGIN, free: ['queue', 'charset', 'maxStoreAttempts', ...SOURCE_COMMON] },
};

const DESTINATION_KEYS: Readonly<Record<DestinationConnectorType, ConnectorKeys>> = {
  TCP_MLLP: {
    deciding: ['host', 'port', 'tls'],
    free: ['maxConnections', 'responseTimeout', 'acquireTimeoutMs', 'charset', 'frameStart', 'frameEnd', ...DESTINATION_COMMON],
    credentials: [],
  },
  HTTP: {
    // `parameters` is the rest of the URL, and a Host header picks the server behind it.
    deciding: ['url', 'parameters', 'headers', 'basicAuth', 'scheme', 'tls'],
    free: ['method', 'contentType', 'responseTimeout', ...DESTINATION_COMMON],
    credentials: [],
  },
  FILE: withoutCredentials('directory', 'outputPattern', 'charset', 'binary', 'tempFileEnabled', 'appendMode', ...DESTINATION_COMMON),
  DATABASE: { ...DATABASE_LOGIN, free: ['query', 'useTransaction', 'returnGeneratedKeys', ...DESTINATION_COMMON] },
  JAVASCRIPT: withoutCredentials('script', 'scriptLanguage', ...DESTINATION_COMMON),
  SMTP: {
    deciding: ['host', 'port', 'secure', 'requireTLS', 'authUser'],
    free: ['from', 'to', 'cc', 'bcc', 'subject', 'bodyTemplate', 'contentType', 'attachContent', 'attachments', ...DESTINATION_COMMON],
    credentials: ['authPass'],
  },
  CHANNEL: withoutCredentials('targetChannelId', 'waitForResponse', ...DESTINATION_COMMON),
  FHIR: {
    // `resourceType` is the rest of the URL.
    deciding: ['baseUrl', 'resourceType', 'authType', 'authUsername', 'authHeaderName', 'headers'],
    free: ['method', 'format', 'timeout', ...DESTINATION_COMMON],
    credentials: ['authPassword', 'authToken', 'authApiKey'],
  },
  DICOM: withoutCredentials(
    'host', 'port', 'calledAETitle', 'callingAETitle', 'maxRetries', 'retryDelayMs', 'timeoutMs', ...DESTINATION_COMMON,
  ),
  SFTP: { ...SFTP_LOGIN, free: ['remoteDirectory', 'fileNameTemplate', 'appendMode', ...DESTINATION_COMMON] },
  // A message header can hold a credential too, and it goes where the message goes.
  KAFKA: {
    deciding: [...KAFKA_LOGIN.deciding, 'topic'],
    free: ['messageKey', 'headers', ...DESTINATION_COMMON],
    credentials: KAFKA_LOGIN.credentials,
  },
  AMQP: {
    deciding: [...AMQP_LOGIN.deciding, 'exchange', 'routingKey'],
    free: ['headers', 'contentType', ...DESTINATION_COMMON],
    credentials: AMQP_LOGIN.credentials,
  },
};

export const CONNECTOR_KEYS = { source: SOURCE_KEYS, destination: DESTINATION_KEYS } as const;

function keysOf(direction: ConnectorDirection, connectorType: string): ConnectorKeys | undefined {
  if (direction === 'source') return isSourceConnectorType(connectorType) ? SOURCE_KEYS[connectorType] : undefined;
  return isDestinationConnectorType(connectorType) ? DESTINATION_KEYS[connectorType] : undefined;
}

export interface ConnectorSettings {
  readonly connectorType: string;
  readonly properties: unknown;
}

function sameTarget(merged: unknown, stored: unknown, keys: ConnectorKeys): boolean {
  const ignored = new Set([...keys.free, ...keys.credentials]);
  return isDeepStrictEqual(withoutKeys(merged, ignored), withoutKeys(stored, ignored));
}

/** `stored` is the connector the file's one replaces: the source, or the destination with its metaDataId. */
export function overwriteProperties(
  direction: ConnectorDirection, imported: ConnectorSettings, stored: ConnectorSettings | undefined,
): Record<string, unknown> {
  const keys = keysOf(direction, imported.connectorType);
  if (keys && stored?.connectorType === imported.connectorType) {
    // The stored secrets go in first, so a masked one equals its stored value and any other difference shows.
    const merged = stripRedactedProperties(imported.properties, stored.properties);
    if (sameTarget(merged, stored.properties, keys)) return merged;
  }
  return stripRedactedProperties(imported.properties);
}
