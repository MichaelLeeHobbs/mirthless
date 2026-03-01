// ===========================================
// Connector Registry
// ===========================================
// Maps connector types to factory functions.

import type { SourceConnectorRuntime, DestinationConnectorRuntime } from './base.js';
import { TcpMllpReceiver } from './tcp-mllp/tcp-mllp-receiver.js';
import { TcpMllpDispatcher } from './tcp-mllp/tcp-mllp-dispatcher.js';
import { HttpReceiver } from './http/http-receiver.js';
import { HttpDispatcher } from './http/http-dispatcher.js';
import { FileReceiver, FILE_SORT_BY, FILE_POST_ACTION, type FileSortBy, type FilePostAction } from './file/file-receiver.js';
import { FileDispatcher } from './file/file-dispatcher.js';
import { DatabaseReceiver, UPDATE_MODE, ROW_FORMAT, type UpdateMode, type RowFormat } from './database/database-receiver.js';
import { DatabaseDispatcher } from './database/database-dispatcher.js';

// ----- Source Factories -----

type SourceFactory = (properties: Record<string, unknown>) => SourceConnectorRuntime;

const sourceFactories = new Map<string, SourceFactory>([
  ['TCP_MLLP', (props): SourceConnectorRuntime => new TcpMllpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: props['port'] as number,
    maxConnections: (props['maxConnections'] as number | undefined) ?? 10,
  })],
  ['HTTP', (props): SourceConnectorRuntime => new HttpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: props['port'] as number,
    path: (props['path'] as string | undefined) ?? '/',
    method: (props['method'] as string | undefined) ?? 'POST',
    responseContentType: (props['responseContentType'] as string | undefined) ?? 'text/plain',
    responseStatusCode: (props['responseStatusCode'] as number | undefined) ?? 200,
  })],
  ['FILE', (props): SourceConnectorRuntime => new FileReceiver({
    directory: props['directory'] as string,
    fileFilter: (props['fileFilter'] as string | undefined) ?? '*',
    pollingIntervalMs: (props['pollingIntervalMs'] as number | undefined) ?? 5_000,
    sortBy: (props['sortBy'] as FileSortBy | undefined) ?? FILE_SORT_BY.NAME,
    charset: (props['charset'] as BufferEncoding | undefined) ?? 'utf-8',
    binary: (props['binary'] as boolean | undefined) ?? false,
    checkFileAge: (props['checkFileAge'] as boolean | undefined) ?? true,
    fileAgeMs: (props['fileAgeMs'] as number | undefined) ?? 1_000,
    postAction: (props['postAction'] as FilePostAction | undefined) ?? FILE_POST_ACTION.DELETE,
    moveToDirectory: (props['moveToDirectory'] as string | undefined) ?? '',
  })],
  ['DATABASE', (props): SourceConnectorRuntime => new DatabaseReceiver({
    host: props['host'] as string,
    port: (props['port'] as number | undefined) ?? 5432,
    database: props['database'] as string,
    username: props['username'] as string,
    password: props['password'] as string,
    selectQuery: props['selectQuery'] as string,
    updateQuery: (props['updateQuery'] as string | undefined) ?? '',
    updateMode: (props['updateMode'] as UpdateMode | undefined) ?? UPDATE_MODE.NEVER,
    pollingIntervalMs: (props['pollingIntervalMs'] as number | undefined) ?? 5_000,
    rowFormat: (props['rowFormat'] as RowFormat | undefined) ?? ROW_FORMAT.JSON,
  })],
]);

// ----- Destination Factories -----

type DestinationFactory = (properties: Record<string, unknown>) => DestinationConnectorRuntime;

const destinationFactories = new Map<string, DestinationFactory>([
  ['TCP_MLLP', (props): DestinationConnectorRuntime => new TcpMllpDispatcher({
    host: props['host'] as string,
    port: props['port'] as number,
    maxConnections: (props['maxConnections'] as number | undefined) ?? 5,
    responseTimeout: (props['responseTimeout'] as number | undefined) ?? 30_000,
  })],
  ['HTTP', (props): DestinationConnectorRuntime => new HttpDispatcher({
    url: props['url'] as string,
    method: (props['method'] as string | undefined) ?? 'POST',
    headers: (props['headers'] as Record<string, string> | undefined) ?? {},
    contentType: (props['contentType'] as string | undefined) ?? 'text/plain',
    responseTimeout: (props['responseTimeout'] as number | undefined) ?? 30_000,
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
    port: (props['port'] as number | undefined) ?? 5432,
    database: props['database'] as string,
    username: props['username'] as string,
    password: props['password'] as string,
    query: props['query'] as string,
    useTransaction: (props['useTransaction'] as boolean | undefined) ?? false,
    returnGeneratedKeys: (props['returnGeneratedKeys'] as boolean | undefined) ?? false,
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
