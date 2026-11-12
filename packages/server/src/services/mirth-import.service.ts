// ===========================================
// Mirth Connect XML Import Service
// ===========================================
// Converts Mirth Connect XML channel exports to GalvaniFlow JSON format,
// then delegates to ChannelImportService for persistence.

import { tryCatch, type Result } from 'stderr-lib';
import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import type { ChannelExportEntry, ImportResult } from '@galvaniflow/core-models';
import { ChannelImportService } from './channel-import.service.js';
import type { AuditContext } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';
import {
  extractCodeTemplateLibraries, importCodeTemplateLibraries,
  type CodeTemplateImportCounts, type MirthCodeTemplateLibrary,
} from './mirth-code-templates.js';

// ----- Types -----

/** Result of XML conversion (before import). */
export interface MirthConvertResult {
  readonly channels: readonly ChannelExportEntry[];
  /** Code template libraries from a server backup; empty for a channel export. */
  readonly codeTemplateLibraries: readonly MirthCodeTemplateLibrary[];
  readonly warnings: readonly string[];
}

/** Result of XML import (after conversion + persistence). */
export interface MirthImportResult {
  readonly convertResult: MirthConvertResult;
  readonly importResult: ImportResult;
  readonly codeTemplates: CodeTemplateImportCounts;
}

const XML_READERS = { isRecord, getString, toRecordList } as const;

// ----- Connector Type Mapping -----

const CONNECTOR_TYPE_MAP: ReadonlyMap<string, string> = new Map([
  ['com.mirth.connect.connectors.tcp.TcpReceiverProperties', 'TCP_MLLP'],
  ['com.mirth.connect.connectors.tcp.TcpDispatcherProperties', 'TCP_MLLP'],
  ['com.mirth.connect.connectors.http.HttpReceiverProperties', 'HTTP'],
  ['com.mirth.connect.connectors.http.HttpDispatcherProperties', 'HTTP'],
  ['com.mirth.connect.connectors.file.FileReceiverProperties', 'FILE'],
  ['com.mirth.connect.connectors.file.FileDispatcherProperties', 'FILE'],
  ['com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', 'DATABASE'],
  ['com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties', 'DATABASE'],
  ['com.mirth.connect.connectors.js.JavaScriptReceiverProperties', 'JAVASCRIPT'],
  ['com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', 'JAVASCRIPT'],
  ['com.mirth.connect.connectors.smtp.SmtpDispatcherProperties', 'SMTP'],
  ['com.mirth.connect.connectors.vm.VmReceiverProperties', 'CHANNEL'],
  ['com.mirth.connect.connectors.vm.VmDispatcherProperties', 'CHANNEL'],
]);

// ----- XML Parser Config -----

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Keep every value a string: "0123" stays "0123" (a password, a code).
    parseTagValue: false,
    trimValues: true,
    // Mirth escapes scripts with the XML entities (&apos; &lt; ...) and numeric
    // references (&#xd;), so they must be decoded. convertXml rejects a DOCTYPE,
    // which is the only way to define a custom entity, so no entity can expand.
    processEntities: true,
    htmlEntities: true,
    isArray: (tagName: string) => {
      // These elements should always be parsed as arrays even when single
      const arrayTags = new Set([
        'connector', 'step', 'rule', 'entry', 'metaDataColumn',
      ]);
      return arrayTags.has(tagName);
    },
  });
}

// ----- Service -----

export class MirthImportService {
  /** Convert Mirth Connect XML to GalvaniFlow channel entries. */
  static convertXml(xml: string): Result<MirthConvertResult> {
    return tryCatch(() => {
      // Reject a DOCTYPE outright — Mirth exports never carry one, and it is the
      // vehicle for entity-expansion/XXE attacks.
      if (/<!DOCTYPE/i.test(xml)) {
        throw new Error('XML with a DOCTYPE declaration is not allowed');
      }
      const parser = createParser();
      const parsed: unknown = parser.parse(xml);

      if (!isRecord(parsed)) {
        throw new Error('Invalid XML: parsed result is not an object');
      }

      const warnings: string[] = [];
      const channels: ChannelExportEntry[] = [];

      // Handle single channel or serverConfiguration with multiple channels
      const mirthChannels = extractChannels(parsed);

      if (mirthChannels.length === 0) {
        throw new Error('No channels found in XML');
      }

      for (const mirthChannel of mirthChannels) {
        const result = convertChannel(mirthChannel, warnings);
        channels.push(result);
      }
      const codeTemplateLibraries = extractCodeTemplateLibraries(parsed, XML_READERS, warnings);

      return { channels, codeTemplateLibraries, warnings };
    });
  }

  /** Convert Mirth XML then import via ChannelImportService. */
  static async importFromXml(
    xml: string,
    collisionMode: 'SKIP' | 'OVERWRITE' | 'RENAME',
    dryRun: boolean,
    context?: AuditContext,
  ): Promise<Result<MirthImportResult>> {
    return tryCatch(async () => {
      const convertResult = MirthImportService.convertXml(xml);
      if (!convertResult.ok) throw convertResult.error;

      if (dryRun) {
        return {
          convertResult: convertResult.value,
          importResult: {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [],
          },
          codeTemplates: { created: 0, updated: 0, skipped: 0 },
        };
      }

      // Templates first: a channel deployed right after the import compiles with them.
      const templates = await importCodeTemplateLibraries(
        convertResult.value.codeTemplateLibraries, collisionMode === 'OVERWRITE', context,
      );
      if (!templates.ok) throw templates.error;

      // Map RENAME to CREATE_NEW (GalvaniFlow collision mode)
      const galvaniflowCollisionMode = collisionMode === 'RENAME' ? 'CREATE_NEW' as const : collisionMode;
      const importResult = await ChannelImportService.importChannels(
        convertResult.value.channels,
        galvaniflowCollisionMode,
        context,
      );
      if (!importResult.ok) throw importResult.error;

      logger.info(
        { channelCount: convertResult.value.channels.length, warnings: convertResult.value.warnings.length },
        'Mirth Connect XML import completed',
      );

      return {
        convertResult: convertResult.value,
        importResult: importResult.value,
        codeTemplates: templates.value,
      };
    });
  }
}

// ----- Extraction Helpers -----

/** Type guard for plain objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Safely get a string from parsed XML. */
function getString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const val = obj[key];
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return null;
}

/** Safely get a boolean from parsed XML. */
function getBoolean(obj: unknown, key: string, defaultValue: boolean): boolean {
  const val = getString(obj, key);
  if (val === null) return defaultValue;
  return val === 'true';
}

/** Safely get a number from parsed XML. */
function getNumber(obj: unknown, key: string, defaultValue: number): number {
  if (!isRecord(obj)) return defaultValue;
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }
  return defaultValue;
}

/** Extract all channels from parsed XML (handles single channel or serverConfiguration). */
function extractChannels(parsed: Record<string, unknown>): readonly Record<string, unknown>[] {
  // Single channel: <channel> at root
  if (isRecord(parsed['channel'])) {
    return [parsed['channel'] as Record<string, unknown>];
  }

  // ServerConfiguration / list of channels
  const serverConfig = parsed['serverConfiguration'] ?? parsed['list'];
  if (isRecord(serverConfig)) {
    const channelsNode = serverConfig['channels'] ?? serverConfig['channel'];
    if (isRecord(channelsNode)) {
      // Channels wrapper with 'channel' children
      const inner = channelsNode['channel'];
      if (Array.isArray(inner)) {
        return inner.filter(isRecord);
      }
      if (isRecord(inner)) {
        return [inner];
      }
    }
    if (Array.isArray(channelsNode)) {
      return channelsNode.filter(isRecord);
    }
  }

  // Direct list: <channels><channel>...</channel></channels>
  const channelsRoot = parsed['channels'];
  if (isRecord(channelsRoot)) {
    const inner = channelsRoot['channel'];
    if (Array.isArray(inner)) {
      return inner.filter(isRecord);
    }
    if (isRecord(inner)) {
      return [inner];
    }
  }

  return [];
}

// ----- Channel Conversion -----

function convertChannel(
  mirthChannel: Record<string, unknown>,
  warnings: string[],
): ChannelExportEntry {
  const name = getString(mirthChannel, 'name') ?? 'Unnamed Channel';
  const description = getString(mirthChannel, 'description');
  const enabled = getBoolean(mirthChannel, 'enabled', true);
  const id = getString(mirthChannel, 'id') ?? randomUUID();

  // Source connector
  const sourceConnector = isRecord(mirthChannel['sourceConnector'])
    ? mirthChannel['sourceConnector'] as Record<string, unknown>
    : null;
  const sourceConnectorResult = convertSourceConnector(sourceConnector, name, warnings);

  // Destinations
  const destinations = convertDestinations(mirthChannel, name, warnings);
  const response = mapResponseVariable(sourceConnector, destinations, name, warnings);
  const sourceConnectorProperties = withSourceResponseMode(sourceConnectorResult, response.responseMode);

  // Data types
  const inboundDataType = extractDataType(sourceConnector, 'inbound') ?? 'HL7V2';
  const outboundDataType = extractDataType(sourceConnector, 'outbound') ?? 'HL7V2';

  // Filters and transformers
  const filters = convertFilters(mirthChannel);
  const transformers = convertTransformers(mirthChannel);

  // Channel properties
  const props = isRecord(mirthChannel['properties'])
    ? mirthChannel['properties'] as Record<string, unknown>
    : {};

  return {
    id,
    name,
    description,
    enabled,
    revision: 1,
    inboundDataType,
    outboundDataType,
    sourceConnectorType: sourceConnectorResult.type,
    sourceConnectorProperties,
    responseMode: response.responseMode,
    responseConnectorName: response.responseConnectorName,
    initialState: mapInitialState(getString(props, 'initialState') ?? getString(mirthChannel, 'initialState')),
    messageStorageMode: mapStorageMode(getString(props, 'messageStorageMode')),
    encryptData: getBoolean(props, 'encryptData', false),
    removeContentOnCompletion: getBoolean(props, 'removeContentOnCompletion', false),
    removeAttachmentsOnCompletion: getBoolean(props, 'removeAttachmentsOnCompletion', false),
    pruningEnabled: getBoolean(props, 'pruningEnabled', false),
    pruningMaxAgeDays: null,
    pruningArchiveEnabled: false,
    scripts: convertScripts(mirthChannel),
    destinations,
    metadataColumns: convertMetadataColumns(mirthChannel),
    filters,
    transformers,
  };
}

// ----- Source Response -----

interface ResponseSetting {
  readonly responseMode: string;
  readonly responseConnectorName: string | null;
}

/** Mirth's fixed "Respond from" choices. Any other value names a destination ("d1") or a response map key. */
const RESPONSE_VARIABLE_MAP: ReadonlyMap<string, string> = new Map([
  ['None', 'NONE'],
  ['Auto-generate (Before processing)', 'AUTO_BEFORE'],
  ['Auto-generate (After source transformer)', 'AUTO_AFTER_TRANSFORMER'],
  ['Auto-generate (Destinations completed)', 'AUTO_AFTER_DESTINATIONS'],
  ['Postprocessor', 'POSTPROCESSOR'],
]);

/** Map the source's "Respond from" setting (`sourceConnectorProperties/responseVariable`). */
function mapResponseVariable(
  sourceConnector: Record<string, unknown> | null,
  destinations: ChannelExportEntry['destinations'],
  channelName: string,
  warnings: string[],
): ResponseSetting {
  const props = getNestedRecord(sourceConnector ?? {}, 'properties') ?? {};
  const variable = getString(getNestedRecord(props, 'sourceConnectorProperties') ?? {}, 'responseVariable');
  if (variable === null) return { responseMode: 'NONE', responseConnectorName: null };
  const fixed = RESPONSE_VARIABLE_MAP.get(variable);
  if (fixed) return { responseMode: fixed, responseConnectorName: null };
  const destMatch = /^d(\d+)$/.exec(variable);
  const dest = destMatch ? destinations.find((d) => d.metaDataId === Number(destMatch[1])) : undefined;
  if (dest) return { responseMode: 'DESTINATION', responseConnectorName: dest.name };
  warnings.push(`Channel "${channelName}": responds from "${variable}", which is not supported; it will auto-generate its response after the destinations`);
  return { responseMode: 'AUTO_AFTER_DESTINATIONS', responseConnectorName: null };
}

/**
 * A TCP listener answers with the pipeline's response only in PASSTHROUGH mode.
 * The channel's response comes from a script or a destination in Mirth's
 * "Postprocessor" and "dN" settings, so those need it.
 */
function withSourceResponseMode(source: ConnectorResult, responseMode: string): Record<string, unknown> {
  if (source.type !== 'TCP_MLLP') return source.properties;
  const passthrough = responseMode === 'POSTPROCESSOR' || responseMode === 'DESTINATION';
  return { ...source.properties, responseMode: passthrough ? 'PASSTHROUGH' : 'AUTO_ACK' };
}

// ----- Connector Conversion -----

interface ConnectorResult {
  readonly type: string;
  readonly properties: Record<string, unknown>;
}

function resolveConnectorType(
  className: string | null,
  channelName: string,
  warnings: string[],
): string {
  if (!className) return 'JAVASCRIPT';
  const mapped = CONNECTOR_TYPE_MAP.get(className);
  if (mapped) return mapped;
  warnings.push(`Channel "${channelName}": Unknown connector type "${className}", defaulting to JAVASCRIPT`);
  return 'JAVASCRIPT';
}

function convertSourceConnector(
  sourceConnector: Record<string, unknown> | null,
  channelName: string,
  warnings: string[],
): ConnectorResult {
  if (!sourceConnector) {
    return { type: 'JAVASCRIPT', properties: {} };
  }

  const transportName = getString(sourceConnector, 'transportName');
  const propsNode = isRecord(sourceConnector['properties'])
    ? sourceConnector['properties'] as Record<string, unknown>
    : {};

  // Get the class name from @_class attribute on properties
  const className = typeof propsNode['@_class'] === 'string' ? propsNode['@_class'] : null;
  const connectorType = resolveConnectorType(className, channelName, warnings);

  // Also try transportName-based resolution as fallback
  const finalType = connectorType !== 'JAVASCRIPT' || !transportName
    ? connectorType
    : mapTransportName(transportName, channelName, warnings);

  const properties = extractConnectorProperties(propsNode, finalType);
  return { type: finalType, properties };
}

function mapTransportName(transportName: string, channelName: string, warnings: string[]): string {
  const transportMap: Record<string, string> = {
    'TCP Listener': 'TCP_MLLP',
    'TCP Sender': 'TCP_MLLP',
    'HTTP Listener': 'HTTP',
    'HTTP Sender': 'HTTP',
    'File Reader': 'FILE',
    'File Writer': 'FILE',
    'Database Reader': 'DATABASE',
    'Database Writer': 'DATABASE',
    'JavaScript Reader': 'JAVASCRIPT',
    'JavaScript Writer': 'JAVASCRIPT',
    'SMTP Sender': 'SMTP',
    'Channel Reader': 'CHANNEL',
    'Channel Writer': 'CHANNEL',
    'DICOM Listener': 'DICOM',
    'DICOM Sender': 'DICOM',
  };
  const mapped = transportMap[transportName];
  if (mapped) return mapped;
  warnings.push(`Channel "${channelName}": Unknown transport name "${transportName}", defaulting to JAVASCRIPT`);
  return 'JAVASCRIPT';
}

function extractConnectorProperties(propsNode: Record<string, unknown>, connectorType: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Extract properties based on connector type
  switch (connectorType) {
    case 'TCP_MLLP': {
      const host = getString(propsNode, 'listenerConnectorProperties')
        ?? getString(getNestedRecord(propsNode, 'listenerConnectorProperties'), 'host');
      const port = getNestedRecord(propsNode, 'listenerConnectorProperties');
      if (host) result['host'] = host;
      if (port) {
        const portVal = getString(port, 'port');
        if (portVal) result['port'] = Number(portVal);
      }
      // For dispatcher
      const remoteAddress = getString(propsNode, 'remoteAddress');
      if (remoteAddress) result['host'] = remoteAddress;
      const remotePort = getString(propsNode, 'remotePort');
      if (remotePort) result['port'] = Number(remotePort);
      break;
    }
    case 'HTTP': {
      const listener = getNestedRecord(propsNode, 'listenerConnectorProperties');
      if (listener) {
        const host = getString(listener, 'host');
        const port = getString(listener, 'port');
        if (host) result['host'] = host;
        if (port) result['port'] = Number(port);
        Object.assign(result, httpListenerProperties(propsNode));
      }
      const url = getString(propsNode, 'host');
      if (url) result['url'] = url;
      break;
    }
    case 'FILE': {
      const dir = getString(propsNode, 'host');
      if (dir) result['directory'] = dir;
      const fileFilter = getString(propsNode, 'fileFilter');
      if (fileFilter) result['fileFilter'] = fileFilter;
      const moveToDir = getString(propsNode, 'moveToDirectory');
      if (moveToDir) result['moveToDirectory'] = moveToDir;
      break;
    }
    case 'DATABASE': {
      const url = getString(propsNode, 'url');
      if (url) result['url'] = url;
      const query = getString(propsNode, 'query') ?? getString(propsNode, 'select');
      if (query) result['query'] = query;
      const driver = getString(propsNode, 'driver');
      if (driver) result['driver'] = driver;
      const username = getString(propsNode, 'username');
      if (username) result['username'] = username;
      break;
    }
    case 'SMTP': {
      const smtpHost = getString(propsNode, 'smtpHost');
      if (smtpHost) result['host'] = smtpHost;
      const smtpPort = getString(propsNode, 'smtpPort');
      if (smtpPort) result['port'] = Number(smtpPort);
      const to = getString(propsNode, 'to');
      if (to) result['to'] = to;
      const from = getString(propsNode, 'from');
      if (from) result['from'] = from;
      break;
    }
    case 'CHANNEL': {
      // Channel Writer: the target is the Mirth channel id, which the import
      // keeps as the channel's id. "none" is Mirth's "no channel selected".
      const target = getString(propsNode, 'channelId');
      if (target !== null) result['targetChannelId'] = target === 'none' ? '' : target;
      break;
    }
    default:
      // For JAVASCRIPT and others, copy all non-attribute properties
      for (const [key, value] of Object.entries(propsNode)) {
        if (!key.startsWith('@_')) {
          result[key] = value;
        }
      }
      break;
  }

  return result;
}

/**
 * Mirth's HTTP Listener serves every path under its context path (empty: all
 * paths) and answers with its configured content type and status.
 */
function httpListenerProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const contextPath = getString(propsNode, 'contextPath') ?? '';
  const result: Record<string, unknown> = {
    path: contextPath.startsWith('/') ? contextPath : `/${contextPath}`,
    matchSubpaths: true,
  };
  const contentType = getString(propsNode, 'responseContentType');
  if (contentType) result['responseContentType'] = contentType;
  const status = Number(getString(propsNode, 'responseStatusCode') ?? '');
  if (Number.isInteger(status) && status >= 100 && status <= 599) result['responseStatusCode'] = status;
  return result;
}

function getNestedRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const val = obj[key];
  return isRecord(val) ? val as Record<string, unknown> : null;
}

// ----- Destination Conversion -----

function convertDestinations(
  mirthChannel: Record<string, unknown>,
  channelName: string,
  warnings: string[],
): ChannelExportEntry['destinations'] {
  const destinationConnectors = mirthChannel['destinationConnectors'];
  if (!isRecord(destinationConnectors) && !Array.isArray(destinationConnectors)) return [];

  let connectorList: readonly Record<string, unknown>[];
  if (Array.isArray(destinationConnectors)) {
    connectorList = destinationConnectors.filter(isRecord);
  } else {
    // destinationConnectors wraps <connector> children
    const inner = destinationConnectors['connector'];
    if (Array.isArray(inner)) {
      connectorList = inner.filter(isRecord);
    } else if (isRecord(inner)) {
      connectorList = [inner];
    } else {
      return [];
    }
  }

  return connectorList.map((dest, idx) => {
    const propsNode = isRecord(dest['properties'])
      ? dest['properties'] as Record<string, unknown>
      : {};
    const className = typeof propsNode['@_class'] === 'string' ? propsNode['@_class'] : null;
    const transportName = getString(dest, 'transportName');
    let connectorType = resolveConnectorType(className, channelName, warnings);
    if (connectorType === 'JAVASCRIPT' && transportName) {
      connectorType = mapTransportName(transportName, channelName, warnings);
    }

    const properties = extractConnectorProperties(propsNode, connectorType);

    return {
      metaDataId: destinationMetaDataId(dest, idx),
      name: getString(dest, 'name') ?? `Destination ${idx + 1}`,
      enabled: getBoolean(dest, 'enabled', true),
      connectorType,
      properties,
      ...convertQueueSettings(dest, propsNode),
      waitForPrevious: getBoolean(dest, 'waitForPrevious', false),
    };
  });
}

/** Mirth numbers destinations itself (d1, d2 ...); scripts and "Respond from" refer to that number. */
function destinationMetaDataId(dest: Record<string, unknown>, idx: number): number {
  const fromXml = getNumber(dest, 'metaDataId', 0);
  return Number.isInteger(fromXml) && fromXml > 0 ? fromXml : idx + 1;
}

type QueueSettings = Pick<ChannelExportEntry['destinations'][number],
  'queueMode' | 'retryCount' | 'retryIntervalMs' | 'rotateQueue' | 'queueThreadCount'>;

/**
 * Mirth 3.x/4.x keep queue settings in `properties/destinationConnectorProperties`.
 * "Queue Messages" Never / On Failure / Always is `queueEnabled` false, or true
 * with `sendFirst` true (try first, queue on failure) or false (always queue).
 * The older `queueConnectorProperties` node is still read when present.
 */
function convertQueueSettings(dest: Record<string, unknown>, propsNode: Record<string, unknown>): QueueSettings {
  const modern = getNestedRecord(propsNode, 'destinationConnectorProperties');
  if (modern) {
    const enabled = getBoolean(modern, 'queueEnabled', false);
    return {
      queueMode: !enabled ? 'NEVER' : getBoolean(modern, 'sendFirst', false) ? 'ON_FAILURE' : 'ALWAYS',
      retryCount: getNumber(modern, 'retryCount', 0),
      retryIntervalMs: getNumber(modern, 'retryIntervalMillis', 10000),
      rotateQueue: getBoolean(modern, 'rotate', false),
      queueThreadCount: Math.max(1, getNumber(modern, 'threadCount', 1)),
    };
  }
  const legacy = getNestedRecord(dest, 'queueConnectorProperties') ?? {};
  return {
    queueMode: mapQueueMode(getString(dest, 'queueMode') ?? getString(legacy, 'queueEnabled')),
    retryCount: getNumber(legacy, 'retryCount', 0),
    retryIntervalMs: getNumber(legacy, 'retryIntervalMs', 10000),
    rotateQueue: getBoolean(legacy, 'rotate', false),
    queueThreadCount: getNumber(legacy, 'threadCount', 1),
  };
}

function mapQueueMode(value: string | null): string {
  if (!value) return 'NEVER';
  const upper = value.toUpperCase();
  if (upper === 'ALWAYS' || upper === 'TRUE') return 'ALWAYS';
  if (upper === 'ON_FAILURE') return 'ON_FAILURE';
  return 'NEVER';
}

// ----- Data Type Extraction -----

function extractDataType(
  connector: Record<string, unknown> | null,
  direction: 'inbound' | 'outbound',
): string | null {
  if (!connector) return null;

  const transformer = isRecord(connector['transformer'])
    ? connector['transformer'] as Record<string, unknown>
    : null;
  if (!transformer) return null;

  const key = direction === 'inbound' ? 'inboundDataType' : 'outboundDataType';
  return getString(transformer, key);
}

// ----- Filter Conversion -----

function convertFilters(mirthChannel: Record<string, unknown>): ChannelExportEntry['filters'] {
  const filters: ChannelExportEntry['filters'] = [];

  // Source connector filter
  const sourceFilter = extractFilterFromConnector(mirthChannel['sourceConnector'], null);
  if (sourceFilter) filters.push(sourceFilter);

  // Destination connector filters
  for (const [metaDataId, conn] of destinationConnectorsById(mirthChannel)) {
    const filter = extractFilterFromConnector(conn, metaDataId);
    if (filter) filters.push(filter);
  }

  return filters;
}

/** Destination connector nodes keyed by their metaDataId, as filters and transformers refer to them. */
function destinationConnectorsById(mirthChannel: Record<string, unknown>): ReadonlyArray<readonly [number, Record<string, unknown>]> {
  const destConnectors = mirthChannel['destinationConnectors'];
  if (!isRecord(destConnectors)) return [];
  const connectorList = toRecordList(destConnectors['connector']);
  return connectorList.map((conn, idx) => [destinationMetaDataId(conn, idx), conn] as const);
}

/** A parsed child that may be one element or many. */
function toRecordList(node: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(node)) return node.filter(isRecord);
  return isRecord(node) ? [node] : [];
}

interface ScriptElement {
  /** Mirth 3.4+ element class without its package (`JavaScriptStep`); null for the 3.x `<step>` form. */
  readonly className: string | null;
  readonly node: Record<string, unknown>;
}

/**
 * Filter rules and transformer steps. Mirth 3.4+ lists them under `<elements>`,
 * one child per element named by its class
 * (`com.mirth.connect.plugins.javascriptstep.JavaScriptStep`). Earlier versions
 * use `<steps><step>` and `<rules><rule>` with a `<type>` child.
 */
function scriptElements(container: Record<string, unknown>, legacyKey: 'steps' | 'rules', legacyChild: 'step' | 'rule'): readonly ScriptElement[] {
  const elements = container['elements'];
  if (isRecord(elements)) {
    const result: ScriptElement[] = [];
    for (const [key, value] of Object.entries(elements)) {
      if (key.startsWith('@_')) continue;
      const className = key.slice(key.lastIndexOf('.') + 1);
      for (const node of toRecordList(value)) result.push({ className, node });
    }
    return result.sort((a, b) => getNumber(a.node, 'sequenceNumber', 0) - getNumber(b.node, 'sequenceNumber', 0));
  }
  const legacy = container[legacyKey] ?? container[legacyChild];
  const list = isRecord(legacy) ? toRecordList(legacy[legacyChild]) : toRecordList(legacy);
  return list.map((node) => ({ className: null, node }));
}

function extractFilterFromConnector(
  connector: unknown,
  metaDataId: number | null,
): ChannelExportEntry['filters'][number] | null {
  if (!isRecord(connector)) return null;

  // Mirth 3.x/4.x: <filter> is a sibling of <transformer>. Older exports nest it.
  const transformer = getNestedRecord(connector, 'transformer');
  const filter = getNestedRecord(connector, 'filter') ?? (transformer ? getNestedRecord(transformer, 'filter') : null);
  if (!filter) return null;

  const rules = scriptElements(filter, 'rules', 'rule').map(({ className, node: rule }) => ({
    enabled: getBoolean(rule, 'enabled', true),
    name: getString(rule, 'name'),
    operator: getString(rule, 'operator') ?? 'AND',
    type: mapFilterRuleType(className ?? getString(rule, 'type')),
    script: getString(rule, 'script'),
    field: getString(rule, 'field'),
    condition: getString(rule, 'condition'),
    values: extractStringArray(rule['values']),
  }));

  if (rules.length === 0) return null;

  return { connectorId: null, metaDataId, rules };
}

function mapFilterRuleType(type: string | null): string {
  if (!type) return 'JAVASCRIPT';
  const upper = type.toUpperCase();
  if (upper.includes('JAVASCRIPT') || upper === 'RULE_BUILDER') return 'JAVASCRIPT';
  return upper;
}

function extractStringArray(node: unknown): string[] | null {
  if (!node) return null;
  if (Array.isArray(node)) return node.map(String);
  if (isRecord(node)) {
    const inner = node['string'];
    if (Array.isArray(inner)) return inner.map(String);
    if (typeof inner === 'string') return [inner];
  }
  return null;
}

// ----- Transformer Conversion -----

function convertTransformers(mirthChannel: Record<string, unknown>): ChannelExportEntry['transformers'] {
  const transformers: ChannelExportEntry['transformers'] = [];

  // Source connector transformer
  const sourceTransformer = extractTransformerFromConnector(mirthChannel['sourceConnector'], null);
  if (sourceTransformer) transformers.push(sourceTransformer);

  // Destination connector transformers
  for (const [metaDataId, conn] of destinationConnectorsById(mirthChannel)) {
    const transformer = extractTransformerFromConnector(conn, metaDataId);
    if (transformer) transformers.push(transformer);
  }

  return transformers;
}

function extractTransformerFromConnector(
  connector: unknown,
  metaDataId: number | null,
): ChannelExportEntry['transformers'][number] | null {
  if (!isRecord(connector)) return null;

  const transformer = connector['transformer'];
  if (!isRecord(transformer)) return null;

  const steps = scriptElements(transformer, 'steps', 'step').map(({ className, node: step }) => ({
    enabled: getBoolean(step, 'enabled', true),
    name: getString(step, 'name'),
    type: mapTransformerStepType(className ?? getString(step, 'type')),
    script: getString(step, 'script'),
    sourceField: getString(step, 'sourceField') ?? getString(step, 'field'),
    targetField: getString(step, 'targetField') ?? getString(step, 'variable'),
    defaultValue: getString(step, 'defaultValue'),
    mapping: getString(step, 'mapping'),
  }));

  const inboundDataType = getString(transformer, 'inboundDataType') ?? 'HL7V2';
  const outboundDataType = getString(transformer, 'outboundDataType') ?? 'HL7V2';

  // Only include transformer if it has steps or explicit data types
  if (steps.length === 0 && inboundDataType === 'HL7V2' && outboundDataType === 'HL7V2') {
    return null;
  }

  return {
    connectorId: null,
    metaDataId,
    inboundDataType,
    outboundDataType,
    inboundProperties: extractDataTypeProperties(transformer, 'inboundProperties'),
    outboundProperties: extractDataTypeProperties(transformer, 'outboundProperties'),
    inboundTemplate: getString(transformer, 'inboundTemplate'),
    outboundTemplate: getString(transformer, 'outboundTemplate'),
    steps,
  };
}

function extractDataTypeProperties(transformer: Record<string, unknown>, key: string): Record<string, unknown> {
  const node = transformer[key];
  if (!isRecord(node)) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith('@_')) {
      result[k] = v;
    }
  }
  return result;
}

function mapTransformerStepType(type: string | null): string {
  if (!type) return 'JAVASCRIPT';
  const upper = type.toUpperCase();
  if (upper.includes('JAVASCRIPT') || upper === 'STEP_BUILDER') return 'JAVASCRIPT';
  if (upper.includes('MAPPER') || upper === 'MAPPER') return 'MAPPER';
  if (upper.includes('MESSAGE_BUILDER') || upper === 'MESSAGEBUILDERSTEP') return 'MESSAGE_BUILDER';
  return upper;
}

// ----- Script Conversion -----

function convertScripts(mirthChannel: Record<string, unknown>): ChannelExportEntry['scripts'] {
  const scripts: ChannelExportEntry['scripts'] = [];

  const deployScript = getString(mirthChannel, 'deployScript');
  if (deployScript) scripts.push({ scriptType: 'DEPLOY', script: deployScript });

  const undeployScript = getString(mirthChannel, 'undeployScript');
  if (undeployScript) scripts.push({ scriptType: 'UNDEPLOY', script: undeployScript });

  const preprocessingScript = getString(mirthChannel, 'preprocessingScript');
  if (preprocessingScript) scripts.push({ scriptType: 'PREPROCESSOR', script: preprocessingScript });

  const postprocessingScript = getString(mirthChannel, 'postprocessingScript');
  if (postprocessingScript) scripts.push({ scriptType: 'POSTPROCESSOR', script: postprocessingScript });

  return scripts;
}

// ----- Metadata Column Conversion -----

function convertMetadataColumns(mirthChannel: Record<string, unknown>): ChannelExportEntry['metadataColumns'] {
  const props = isRecord(mirthChannel['properties'])
    ? mirthChannel['properties'] as Record<string, unknown>
    : {};
  const columns = props['metaDataColumns'];
  if (!isRecord(columns)) return [];

  const inner = columns['metaDataColumn'];
  if (!inner) return [];

  const list = Array.isArray(inner) ? inner : [inner];
  return list.filter(isRecord).map((col) => ({
    name: getString(col, 'name') ?? '',
    dataType: getString(col, 'type') ?? 'STRING',
    mappingExpression: getString(col, 'mappingName'),
  }));
}

// ----- State/Mode Mapping -----

function mapInitialState(state: string | null): string {
  if (!state) return 'STARTED';
  const upper = state.toUpperCase();
  if (upper === 'STARTED' || upper === 'START') return 'STARTED';
  if (upper === 'STOPPED' || upper === 'STOP') return 'STOPPED';
  if (upper === 'PAUSED' || upper === 'PAUSE') return 'PAUSED';
  return 'STARTED';
}

function mapStorageMode(mode: string | null): string {
  if (!mode) return 'DEVELOPMENT';
  const upper = mode.toUpperCase();
  if (upper === 'DEVELOPMENT') return 'DEVELOPMENT';
  if (upper === 'PRODUCTION') return 'PRODUCTION';
  if (upper === 'RAW') return 'RAW';
  if (upper === 'METADATA') return 'METADATA';
  if (upper === 'DISABLED') return 'DISABLED';
  return 'DEVELOPMENT';
}
