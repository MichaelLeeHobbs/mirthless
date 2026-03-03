// ===========================================
// Mirth Connect XML Import Service
// ===========================================
// Converts Mirth Connect XML channel exports to Mirthless JSON format,
// then delegates to ChannelImportService for persistence.

import { tryCatch, type Result } from 'stderr-lib';
import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import type { ChannelExportEntry, ImportResult } from '@mirthless/core-models';
import { ChannelImportService } from './channel-import.service.js';
import type { AuditContext } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';

// ----- Types -----

/** Result of XML conversion (before import). */
export interface MirthConvertResult {
  readonly channels: readonly ChannelExportEntry[];
  readonly warnings: readonly string[];
}

/** Result of XML import (after conversion + persistence). */
export interface MirthImportResult {
  readonly convertResult: MirthConvertResult;
  readonly importResult: ImportResult;
}

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
]);

// ----- XML Parser Config -----

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: true,
    trimValues: true,
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
  /** Convert Mirth Connect XML to Mirthless channel entries. */
  static convertXml(xml: string): Result<MirthConvertResult> {
    return tryCatch(() => {
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

      return { channels, warnings };
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
        };
      }

      // Map RENAME to CREATE_NEW (Mirthless collision mode)
      const mirthlessCollisionMode = collisionMode === 'RENAME' ? 'CREATE_NEW' as const : collisionMode;
      const importResult = await ChannelImportService.importChannels(
        convertResult.value.channels,
        mirthlessCollisionMode,
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
    sourceConnectorProperties: sourceConnectorResult.properties,
    responseMode: getString(props, 'responseMode') ?? getString(mirthChannel, 'responseMode') ?? 'NONE',
    responseConnectorName: getString(props, 'responseConnectorName') ?? null,
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
      metaDataId: idx + 1,
      name: getString(dest, 'name') ?? `Destination ${idx + 1}`,
      enabled: getBoolean(dest, 'enabled', true),
      connectorType,
      properties,
      queueMode: mapQueueMode(getString(dest, 'queueMode') ?? getString(getNestedRecord(dest, 'queueConnectorProperties') ?? {}, 'queueEnabled')),
      retryCount: getNumber(getNestedRecord(dest, 'queueConnectorProperties') ?? {}, 'retryCount', 0),
      retryIntervalMs: getNumber(getNestedRecord(dest, 'queueConnectorProperties') ?? {}, 'retryIntervalMs', 10000),
      rotateQueue: getBoolean(getNestedRecord(dest, 'queueConnectorProperties') ?? {}, 'rotate', false),
      queueThreadCount: getNumber(getNestedRecord(dest, 'queueConnectorProperties') ?? {}, 'threadCount', 1),
      waitForPrevious: getBoolean(dest, 'waitForPrevious', false),
    };
  });
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
  const destConnectors = mirthChannel['destinationConnectors'];
  if (isRecord(destConnectors)) {
    const inner = destConnectors['connector'];
    const connectorList = Array.isArray(inner) ? inner : isRecord(inner) ? [inner] : [];
    for (let i = 0; i < connectorList.length; i++) {
      const conn = connectorList[i];
      if (!isRecord(conn)) continue;
      const metaDataId = String(i + 1);
      const filter = extractFilterFromConnector(conn, metaDataId);
      if (filter) filters.push(filter);
    }
  }

  return filters;
}

function extractFilterFromConnector(
  connector: unknown,
  connectorId: string | null,
): ChannelExportEntry['filters'][number] | null {
  if (!isRecord(connector)) return null;

  const transformer = connector['transformer'];
  if (!isRecord(transformer)) return null;

  const filter = transformer['filter'];
  if (!isRecord(filter)) return null;

  const rulesNode = filter['rules'] ?? filter['rule'];
  let rulesList: readonly unknown[];

  if (isRecord(rulesNode)) {
    const inner = rulesNode['rule'];
    if (Array.isArray(inner)) {
      rulesList = inner;
    } else if (isRecord(inner)) {
      rulesList = [inner];
    } else {
      return null;
    }
  } else if (Array.isArray(rulesNode)) {
    rulesList = rulesNode;
  } else {
    return null;
  }

  const rules = rulesList.filter(isRecord).map((rule) => ({
    enabled: getBoolean(rule, 'enabled', true),
    name: getString(rule, 'name'),
    operator: getString(rule, 'operator') ?? 'AND',
    type: mapFilterRuleType(getString(rule, 'type')),
    script: getString(rule, 'script'),
    field: getString(rule, 'field'),
    condition: getString(rule, 'condition'),
    values: extractStringArray(rule['values']),
  }));

  if (rules.length === 0) return null;

  return { connectorId, rules };
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
  const destConnectors = mirthChannel['destinationConnectors'];
  if (isRecord(destConnectors)) {
    const inner = destConnectors['connector'];
    const connectorList = Array.isArray(inner) ? inner : isRecord(inner) ? [inner] : [];
    for (let i = 0; i < connectorList.length; i++) {
      const conn = connectorList[i];
      if (!isRecord(conn)) continue;
      const metaDataId = String(i + 1);
      const transformer = extractTransformerFromConnector(conn, metaDataId);
      if (transformer) transformers.push(transformer);
    }
  }

  return transformers;
}

function extractTransformerFromConnector(
  connector: unknown,
  connectorId: string | null,
): ChannelExportEntry['transformers'][number] | null {
  if (!isRecord(connector)) return null;

  const transformer = connector['transformer'];
  if (!isRecord(transformer)) return null;

  const stepsNode = transformer['steps'] ?? transformer['step'];
  let stepsList: readonly unknown[] = [];

  if (isRecord(stepsNode)) {
    const inner = stepsNode['step'];
    if (Array.isArray(inner)) {
      stepsList = inner;
    } else if (isRecord(inner)) {
      stepsList = [inner];
    }
  } else if (Array.isArray(stepsNode)) {
    stepsList = stepsNode;
  }

  const steps = stepsList.filter(isRecord).map((step) => ({
    enabled: getBoolean(step, 'enabled', true),
    name: getString(step, 'name'),
    type: mapTransformerStepType(getString(step, 'type')),
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
    connectorId,
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
  if (upper.includes('MESSAGE_BUILDER')) return 'MESSAGE_BUILDER';
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
