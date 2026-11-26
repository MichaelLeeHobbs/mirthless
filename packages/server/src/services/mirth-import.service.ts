import { tryCatch, type Result } from 'stderr-lib';
import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import {
  isSourceConnectorType,
  isDestinationConnectorType,
  charsetSchema,
  idSchema,
  type ChannelExportEntry,
  type ImportResult,
  type MirthImportInput,
  type SourceConnectorType,
  type DestinationConnectorType,
} from '@galvanigraph/core-models';
import { ChannelImportService } from './channel-import.service.js';
import { CodeTemplateService } from './code-template.service.js';
import type { AuditContext } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';
import {
  extractCodeTemplateLibraries, importCodeTemplateLibraries, keptLibraryNotes,
  type CodeTemplateImportCounts, type MirthCodeTemplateLibrary,
} from './mirth-code-templates.js';
import { connectorType, connectorTypeOfClass, connectorTypeOfTransport } from './mirth-connectors.js';
import { mirthOnlyWarning } from './mirth-only-constructs.js';
import {
  ackWarnings, attachmentHolds, attachmentWarnings, backupHolds, backupWarnings, exportDataWarnings,
  isMirthDefaultScript, smtpHold, smtpTextAttachments, smtpWarnings,
} from './mirth-not-carried.js';
import { referenceNames, referenceWarnings, renameReferences } from './mirth-references.js';
import {
  filterOf, unrunnableStepWarnings, mirthDataType, responseTransformer, responseTransformerWarnings, scriptElements, transforms, transformerSteps,
} from './mirth-steps.js';
import { getBoolean, getNestedRecord, getNumber, getString, stringList, toRecordList } from './mirth-xml.js';
import { withCopies } from '../lib/import-copies.js';
import { batchRefusal } from '../lib/batch-source.js';
import { isPlainObject, unescapeControlChars } from '@galvanigraph/core-util';
import { DATABASE_VENDOR, unknownPlaceholders } from '@galvanigraph/connectors';

export interface MirthConvertResult {
  readonly channels: readonly ChannelExportEntry[];
  readonly codeTemplateLibraries: readonly MirthCodeTemplateLibrary[];
  readonly warnings: readonly string[];
  /** Why a channel may not run until someone decides (D-301), by channel id; a channel disabled in Mirth included. */
  readonly holds: Readonly<Record<string, readonly string[]>>;
  /** Not an export of channels. */
  readonly isBackup: boolean;
}

export interface MirthImportResult {
  readonly convertResult: MirthConvertResult;
  readonly importResult: ImportResult;
  readonly codeTemplates: CodeTemplateImportCounts;
}

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
      // fast-xml-parser gives a lone element as an object, not a one-item array.
      const arrayTags = new Set([
        'connector', 'step', 'rule', 'entry', 'metaDataColumn',
      ]);
      return arrayTags.has(tagName);
    },
  });
}

export class MirthImportService {
  static convertXml(xml: string): Result<MirthConvertResult> {
    return tryCatch(() => {
      // Reject a DOCTYPE outright — Mirth exports never carry one, and it is the
      // vehicle for entity-expansion/XXE attacks.
      if (/<!DOCTYPE/i.test(xml)) {
        throw new Error('XML with a DOCTYPE declaration is not allowed');
      }
      const parser = createParser();
      const parsed: unknown = parser.parse(xml);

      if (!isPlainObject(parsed)) {
        throw new Error('Invalid XML: parsed result is not an object');
      }

      const warnings: string[] = [];
      const channels: ChannelExportEntry[] = [];

      const mirthChannels = extractChannels(parsed);

      if (mirthChannels.length === 0) {
        throw new Error('No channels found in XML');
      }

      const backup = getNestedRecord(parsed, 'serverConfiguration');
      if (backup) warnings.push(...backupWarnings(backup));
      const backupHeld = backup ? backupHolds(backup) : [];
      const holds: Record<string, readonly string[]> = {};
      for (const mirthChannel of mirthChannels) {
        const channelHolds = [...backupHeld, ...disablingSettings(mirthChannel)];
        // With what the conversion adds, so an OVERWRITE of an enabled channel is refused for it too.
        const converted = convertChannel(mirthChannel, channelHolds, warnings);
        channels.push(converted.channel);
        if (converted.holds.length > 0) holds[converted.channel.id] = converted.holds;
      }
      const codeTemplateLibraries = extractCodeTemplateLibraries(parsed, mirthChannels, warnings);

      return { channels, codeTemplateLibraries, warnings, holds, isBackup: backup !== null };
    });
  }

  static async importFromXml(
    xml: string,
    options: Pick<MirthImportInput, 'collisionMode' | 'dryRun' | 'groupId'>,
    context?: AuditContext,
  ): Promise<Result<MirthImportResult>> {
    const { collisionMode, dryRun } = options;
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

      const converted = collisionMode === 'RENAME' ? await asCopies(convertResult.value) : convertResult.value;
      const { warnings, ...result } = await importConverted(converted, options, context);

      logger.info(
        { channelCount: converted.channels.length, warnings: converted.warnings.length + warnings.length },
        'Mirth Connect XML import completed',
      );

      return { convertResult: { ...converted, warnings: [...converted.warnings, ...warnings] }, ...result };
    });
  }
}

/** The file's channels under the ids their copies get, each pointing at the other copies. */
async function asCopies(converted: MirthConvertResult): Promise<MirthConvertResult> {
  const ids = await ChannelImportService.copyIds(converted.channels);
  if (ids.size === 0) return converted;
  const channels = withCopies(converted.channels, ids);
  const newId = (id: string): string => ids.get(id) ?? id;
  const copied = converted.channels.filter((c) => ids.has(c.id)).map((c) => c.name);
  return {
    ...converted,
    channels,
    codeTemplateLibraries: converted.codeTemplateLibraries.map((l) => ({ ...l, channelIds: l.channelIds?.map(newId) ?? null })),
    warnings: [...converted.warnings, ...channels.flatMap((c) => copiedNameWarnings(c, copied))],
    holds: Object.fromEntries(Object.entries(converted.holds).map(([id, holds]) => [newId(id), holds])),
  };
}

/** A script reaches a channel by its name, which a copy keeps. */
function copiedNameWarnings(channel: ChannelExportEntry, copied: readonly string[]): string[] {
  const scripts = channelScripts(channel).join('\n');
  return copied.filter((name) => [`'${name}'`, `"${name}"`, `\`${name}\``].some((text) => scripts.includes(text))).map((name) =>
    `Channel "${channel.name}": its scripts may reach the channel "${name}" by its name, which the original here can have too; give the copy another name and use it in the scripts`);
}

interface ImportedFile extends Pick<MirthImportResult, 'importResult' | 'codeTemplates'> {
  readonly warnings: readonly string[];
}

/**
 * Templates are shared by every channel, so they change only when every
 * channel in the file imported: a failed import must not leave other
 * channels running with templates (or scopes) from a half-applied backup.
 * Channels are not deployed by the import, so the order costs nothing.
 */
async function importConverted(
  converted: MirthConvertResult,
  { collisionMode, groupId }: Pick<MirthImportInput, 'collisionMode' | 'groupId'>,
  context: AuditContext | undefined,
): Promise<ImportedFile> {
  const imported = await ChannelImportService.importChannels(
    converted.channels,
    collisionMode === 'RENAME' ? 'CREATE_NEW' : collisionMode,
    context,
    { ...(groupId === undefined ? {} : { groupId }), holds: converted.holds },
  );
  if (!imported.ok) throw imported.error;

  const channelFailures = imported.value.errors.length;
  const libraries = converted.codeTemplateLibraries.length === 0 ? NO_LIBRARIES
    : channelFailures > 0 ? { ...NO_LIBRARIES, errors: [`Code template libraries were not imported because ${String(channelFailures)} channel(s) failed; fix them and import again`] }
      : await importLibraries(converted, collisionMode === 'OVERWRITE', context);
  return {
    importResult: { ...imported.value, errors: [...imported.value.errors, ...libraries.errors] },
    codeTemplates: libraries.counts,
    warnings: libraries.warnings,
  };
}

interface ImportedLibraries {
  readonly counts: CodeTemplateImportCounts;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const NO_LIBRARIES: ImportedLibraries = { counts: { created: 0, updated: 0, skipped: 0 }, errors: [], warnings: [] };

/** The channels are in by now, so what stops a library is reported beside them, not as a failed import. */
async function importLibraries(converted: MirthConvertResult, overwrite: boolean, context: AuditContext | undefined): Promise<ImportedLibraries> {
  const libraries = converted.codeTemplateLibraries;
  const here = await CodeTemplateService.listLibraries();
  // Other channels share a library here, so only a backup, which is the whole server, replaces it.
  const replace = overwrite && converted.isBackup;
  const imported = here.ok ? await importCodeTemplateLibraries(libraries, replace, context) : here;
  if (!imported.ok) {
    logger.error({ errMsg: imported.error.message, stack: imported.error.stack }, 'Code template libraries of a Mirth import were not imported');
    return { ...NO_LIBRARIES, errors: [`Code template libraries were not imported: ${imported.error.message}`] };
  }
  const kept = here.ok && !replace ? here.value : [];
  const left = overwrite ? libraries.filter((l) => kept.some((k) => k.name === l.name)) : [];
  return {
    ...imported.value,
    warnings: [
      ...left.map((l) => `Code template library "${l.name}" is here already and was left as it is: other channels can share it, so a channel's export only adds what it lacks`),
      ...keptLibraryNotes(libraries, kept, converted.channels),
    ],
  };
}

function extractChannels(parsed: Record<string, unknown>): readonly Record<string, unknown>[] {
  if (isPlainObject(parsed['channel'])) {
    return [parsed['channel'] as Record<string, unknown>];
  }

  const serverConfig = parsed['serverConfiguration'] ?? parsed['list'];
  if (isPlainObject(serverConfig)) {
    const channelsNode = serverConfig['channels'] ?? serverConfig['channel'];
    if (isPlainObject(channelsNode)) {
      const inner = channelsNode['channel'];
      if (Array.isArray(inner)) {
        return inner.filter(isPlainObject);
      }
      if (isPlainObject(inner)) {
        return [inner];
      }
    }
    if (Array.isArray(channelsNode)) {
      return channelsNode.filter(isPlainObject);
    }
  }

  const channelsRoot = parsed['channels'];
  if (isPlainObject(channelsRoot)) {
    const inner = channelsRoot['channel'];
    if (Array.isArray(inner)) {
      return inner.filter(isPlainObject);
    }
    if (isPlainObject(inner)) {
      return [inner];
    }
  }

  return [];
}

function convertChannel(
  mirthChannel: Record<string, unknown>,
  disabling: readonly string[],
  warnings: string[],
): { readonly channel: ChannelExportEntry; readonly holds: readonly string[] } {
  const name = getString(mirthChannel, 'name') ?? 'Unnamed Channel';
  const fileId = getString(mirthChannel, 'id') ?? randomUUID();
  const id = idSchema.safeParse(fileId).data ?? fileId;

  const sourceConnector = isPlainObject(mirthChannel['sourceConnector'])
    ? mirthChannel['sourceConnector'] as Record<string, unknown>
    : null;
  const sourceConnectorResult = convertSourceConnector(sourceConnector, name, warnings);

  // GalvaniGraph's Database Reader hands each row over as a JSON object, where Mirth's
  // hands it over as XML, so such a channel reads JSON.
  const mirthInbound = extractDataType(sourceConnector, 'inbound') ?? 'HL7V2';
  const inboundDataType = sourceConnectorResult.type === 'DATABASE' ? 'JSON' : mirthInbound;
  if (inboundDataType !== mirthInbound) {
    warnings.push(`Channel "${name}": its Database Reader rows arrive as JSON objects here (Mirth: ${mirthInbound}); read columns as msg.column`);
  }

  const destinations = convertDestinations(mirthChannel, { channelName: name, inboundDataType, warnings });
  const response = mapResponseVariable(sourceConnector, destinations, name, warnings);
  const sourceConnectorProperties = withSourceResponseMode(sourceConnectorResult, response.responseMode);
  // The deploy would refuse it: imported enabled, it would fail at the next deploy instead.
  const batchHold = batchRefusal({ inboundDataType, sourceConnectorType: sourceConnectorResult.type, sourceConnectorProperties });
  const allHolds = [...disabling, ...(batchHold === null ? [] : [batchHold])];
  const holds = channelEnabled(mirthChannel) ? allHolds : [];
  const enabled = channelEnabled(mirthChannel) && holds.length === 0;
  const description = withHoldNote(getString(mirthChannel, 'description'), holds);

  const outboundDataType = extractDataType(sourceConnector, 'outbound') ?? 'HL7V2';

  const filters = convertFilters(mirthChannel, { channelName: name, warnings });
  const transformers = convertTransformers(mirthChannel).map((t) =>
    ((t.metaDataId ?? null) === null && t.inboundDataType !== inboundDataType ? { ...t, inboundDataType } : t));

  const props = isPlainObject(mirthChannel['properties'])
    ? mirthChannel['properties'] as Record<string, unknown>
    : {};

  const entry: ChannelExportEntry = {
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
    ...convertPruning(mirthChannel, props, name, warnings),
    scripts: convertScripts(mirthChannel),
    destinations,
    metadataColumns: convertMetadataColumns(mirthChannel),
    filters,
    transformers,
  };
  if (sourceConnector) warnings.push(...ackWarnings(sourceConnector, name));
  warnings.push(...attachmentWarnings(mirthChannel, name), ...exportDataWarnings(mirthChannel, name));
  warnings.push(...transformers.flatMap((t) => unrunnableStepWarnings(t.steps, name)));
  warnings.push(...delimitedWarnings(entry));
  const scriptWarning = mirthOnlyWarning(`Channel "${name}": its scripts use`, channelScripts(entry));
  if (scriptWarning) warnings.push(scriptWarning);
  if (holds.length > 0) {
    warnings.push(`Channel "${name}": imported disabled because ${holds.join(' and ')}; enable it once you have decided how it should run here`);
  }
  return { channel: entry, holds: allHolds };
}

/**
 * Mirth 3.x+ keeps a channel's enabled flag in `exportData/metadata/enabled`;
 * older exports have it on the channel. A disabled channel imported as
 * enabled would be deployed by the next server start.
 */
function channelEnabled(mirthChannel: Record<string, unknown>): boolean {
  const metadata = getNestedRecord(getNestedRecord(mirthChannel, 'exportData') ?? {}, 'metadata');
  if (metadata && getString(metadata, 'enabled') !== null) return getBoolean(metadata, 'enabled', true);
  return getBoolean(mirthChannel, 'enabled', true);
}

type PruningSettings = Pick<ChannelExportEntry, 'pruningEnabled' | 'pruningMaxAgeDays' | 'pruningArchiveEnabled'>;

/** null: Mirth keeps the messages for good. */
function pruneDays(settings: Record<string, unknown>, key: string): number | null {
  const days = getNumber(settings, key, 0);
  return Number.isInteger(days) && days > 0 ? days : null;
}

/**
 * Mirth 3.5+ keeps a channel's pruning in `exportData/metadata/pruningSettings`
 * (earlier exports, in the channel properties): `pruneMetaDataDays` prunes
 * whole messages, `pruneContentDays` only their content. GalvaniGraph prunes
 * whole messages, errored ones included, and archives nothing, so the
 * preview says where the two differ.
 */
function convertPruning(mirthChannel: Record<string, unknown>, props: Record<string, unknown>, channelName: string, warnings: string[]): PruningSettings {
  const metadata = getNestedRecord(getNestedRecord(mirthChannel, 'exportData') ?? {}, 'metadata') ?? {};
  const settings = getNestedRecord(metadata, 'pruningSettings') ?? props;
  const messageDays = pruneDays(settings, 'pruneMetaDataDays');
  const contentDays = pruneDays(settings, 'pruneContentDays');
  // Mirth's pruner skips errored messages unless told otherwise; this one prunes them, so pruning stays off then.
  const prune = messageDays !== null && getBoolean(settings, 'pruneErroredMessages', false);
  const differences: string[] = [];
  if (contentDays !== null && (messageDays === null || contentDays < messageDays)) {
    differences.push(`Mirth removes message content after ${String(contentDays)} days; GalvaniGraph prunes whole messages only, so content is kept ${prune ? `until ${String(messageDays)} days` : 'until pruning is turned on'}`);
  }
  if (messageDays !== null && !prune) {
    differences.push(`Mirth prunes after ${String(messageDays)} days but keeps errored messages; GalvaniGraph would prune errored messages too, so pruning is left off`);
  }
  if (prune && getBoolean(settings, 'archiveEnabled', true)) {
    differences.push('Mirth archives messages before pruning them; GalvaniGraph does not archive');
  }
  if (differences.length > 0) warnings.push(`Channel "${channelName}": its pruning differs here: ${differences.join('; ')}`);
  return { pruningEnabled: prune, pruningMaxAgeDays: messageDays, pruningArchiveEnabled: false };
}

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

interface ConnectorResult<T extends string = string> {
  readonly type: T;
  readonly properties: Record<string, unknown>;
}

function sourceTypeFor(type: string, channelName: string, warnings: string[]): SourceConnectorType {
  if (isSourceConnectorType(type)) return type;
  warnings.push(`Channel "${channelName}": ${type} cannot be a source; imported as JAVASCRIPT`);
  return 'JAVASCRIPT';
}

function destinationTypeFor(type: string, channelName: string, warnings: string[]): DestinationConnectorType {
  if (isDestinationConnectorType(type)) return type;
  warnings.push(`Channel "${channelName}": ${type} cannot be a destination; imported as JAVASCRIPT`);
  return 'JAVASCRIPT';
}

function resolveConnectorType(
  className: string | null,
  channelName: string,
  warnings: string[],
): string {
  if (!className) return 'JAVASCRIPT';
  const mapped = connectorTypeOfClass(className);
  if (mapped) return mapped;
  warnings.push(`Channel "${channelName}": Unknown connector type "${className}", defaulting to JAVASCRIPT`);
  return 'JAVASCRIPT';
}

function convertSourceConnector(
  sourceConnector: Record<string, unknown> | null,
  channelName: string,
  warnings: string[],
): ConnectorResult<SourceConnectorType> {
  if (!sourceConnector) {
    return { type: 'JAVASCRIPT', properties: {} };
  }

  const transportName = getString(sourceConnector, 'transportName');
  const propsNode = isPlainObject(sourceConnector['properties'])
    ? sourceConnector['properties'] as Record<string, unknown>
    : {};

  const className = typeof propsNode['@_class'] === 'string' ? propsNode['@_class'] : null;
  const connectorType = resolveConnectorType(className, channelName, warnings);

  const finalType = sourceTypeFor(
    connectorType !== 'JAVASCRIPT' || !transportName ? connectorType : mapTransportName(transportName, channelName, warnings),
    channelName,
    warnings,
  );

  const remote = remoteFileConnector(finalType, propsNode, 'source', channelName, warnings);
  const properties: Record<string, unknown> = {
    ...(remote?.properties ?? extractConnectorProperties(propsNode, finalType, 'source')),
    ...pollingInterval(propsNode),
    ...(getBoolean(getNestedRecord(propsNode, 'sourceConnectorProperties') ?? {}, 'processBatch', false) ? { processBatch: true } : {}),
    ...(finalType === 'FILE' ? fileReaderIgnoreDot(propsNode) : {}),
  };
  if (finalType === 'DATABASE') warnings.push(...databaseWarnings(propsNode, properties['vendor'], 'Database Reader', channelName));
  if (finalType === 'FILE') warnings.push(...fileConnectorWarnings(propsNode, properties, 'File Reader', channelName));
  if (finalType === 'DICOM') warnings.push(...dicomWarnings(propsNode, 'source', 'DICOM Listener', channelName));
  if (finalType === 'HTTP') warnings.push(...httpListenerWarnings(propsNode, channelName));
  if (finalType === 'TCP_MLLP') warnings.push(...tcpEncodingWarnings(propsNode, properties, 'TCP Listener', channelName));
  const type = remote?.type ?? finalType;
  warnings.push(...referenceWarnings({ type, direction: 'source', label: transportName ?? finalType, properties }, channelName));
  const polling = pollingWarning(propsNode, channelName);
  if (polling) warnings.push(polling);
  return { type, properties };
}

/**
 * A Mirth File Reader (local or SFTP) that reads dotfiles keeps doing so. Mirth's
 * default, skipping them, is the FILE and SFTP sources' default too, so only
 * `ignoreDot` off needs carrying (#244).
 */
function fileReaderIgnoreDot(propsNode: Record<string, unknown>): Record<string, unknown> {
  return getBoolean(propsNode, 'ignoreDot', true) ? {} : { ignoreDot: false };
}

/** `host[:port][/path]`, as a Mirth remote File connector writes its host field. */
const REMOTE_HOST = /^([^:/]+)(?::(\d+))?(\/.*)?$/;

/**
 * A Mirth File Reader or Writer with the SFTP scheme runs on GalvaniGraph's SFTP
 * connector. Other remote schemes (FTP, SMB, S3, WebDAV) have no connector
 * here; the import warns and keeps the channel, which then fails to deploy.
 */
function remoteFileConnector(
  type: string,
  propsNode: Record<string, unknown>,
  direction: 'source' | 'destination',
  channelName: string,
  warnings: string[],
): ConnectorResult<'SFTP'> | null {
  const scheme = fileScheme(propsNode);
  if (type !== 'FILE' || scheme === 'FILE') return null;
  if (scheme !== 'SFTP') {
    warnings.push(`Channel "${channelName}": the ${scheme} file scheme is not supported; this ${direction} will not deploy`);
    return null;
  }
  const match = REMOTE_HOST.exec(getString(propsNode, 'host') ?? '');
  const schemeProps = getNestedRecord(propsNode, 'schemeProperties') ?? {};
  const properties: Record<string, unknown> = {
    host: match?.[1] ?? '',
    remoteDirectory: match?.[3] ?? '/',
    username: getString(propsNode, 'username') ?? '',
    password: getString(propsNode, 'password') ?? '',
    strictHostKey: (getString(schemeProps, 'hostKeyChecking') ?? 'ask') !== 'no',
  };
  if (match?.[2]) properties['port'] = Number(match[2]);
  if (properties['strictHostKey']) {
    warnings.push(`Channel "${channelName}": Mirth checks the SFTP server's host key; enter it on the ${direction} before deploying`);
  }
  return { type: 'SFTP', properties: { ...properties, ...(direction === 'source' ? sftpReaderProperties(propsNode) : sftpWriterProperties(propsNode)) } };
}

function sftpReaderProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  return {
    filePattern: getString(propsNode, 'fileFilter') ?? '*',
    afterProcessing: afterProcessingAction(propsNode),
    moveToDirectory: getString(propsNode, 'moveToDirectory') ?? '',
    ...mirthCharset(propsNode),
  };
}

function sftpWriterProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const pattern = outputFileName(propsNode);
  return {
    ...(pattern ? { fileNameTemplate: pattern } : {}),
    appendMode: getBoolean(propsNode, 'outputAppend', true),
    tempFileEnabled: getBoolean(propsNode, 'temporary', false),
    ...sendTemplate(propsNode, 'template'),
  };
}

function mirthAction(propsNode: Record<string, unknown>): string {
  return (getString(propsNode, 'afterProcessingAction') ?? 'NONE').toUpperCase();
}

/**
 * What a Mirth File Reader does with a file it has read: NONE (Mirth's default,
 * the file stays), MOVE or DELETE. A Move with neither a folder nor a new name
 * leaves the file where it is in Mirth, so it is NONE here, as is a value this
 * importer does not know. A Move that only renames the file in place stays
 * MOVE with no folder, which the deploy refuses: left in place unrenamed, the
 * file would be read again on every poll. The FILE and SFTP sources delete by
 * default, so the action is always written out.
 */
function afterProcessingAction(propsNode: Record<string, unknown>): 'NONE' | 'MOVE' | 'DELETE' {
  const action = mirthAction(propsNode);
  const blank = (key: string): boolean => (getString(propsNode, key) ?? '').trim() === '';
  if (action === 'MOVE') return blank('moveToDirectory') && blank('moveToFileName') ? 'NONE' : 'MOVE';
  return action === 'DELETE' ? 'DELETE' : 'NONE';
}

/**
 * A Mirth File connector's `charsetEncoding` as the FILE `charset`: nothing for
 * Mirth's DEFAULT_ENCODING; the FILE name for a Java name the charset schema
 * knows (`ISO-8859-1` is `latin1`); otherwise the Mirth name as written, which
 * the deploy refuses, naming it (see {@link fileReaderWarnings}).
 */
function mirthCharset(propsNode: Record<string, unknown>): Record<string, unknown> {
  const name = mirthCharsetName(propsNode);
  if (name === '' || name === 'DEFAULT_ENCODING') return {};
  const parsed = charsetSchema.safeParse(name);
  return { charset: parsed.success ? parsed.data : name };
}

/** Mirth's names for the two values a GalvaniGraph output file name can use. */
const MIRTH_FILENAME_VALUES: Readonly<Record<string, string>> = { 'message.messageId': 'messageId', SYSTIME: 'timestamp' };

/** Any other `${...}` stays, so the deploy refuses it and the preview warns (see {@link fileConnectorWarnings}). */
function outputFileName(propsNode: Record<string, unknown>): string | null {
  const pattern = getString(propsNode, 'outputPattern');
  if (pattern === null || pattern.trim() === '') return null;
  return renameReferences(pattern, MIRTH_FILENAME_VALUES);
}

const FILE_SORT_ORDER: Readonly<Record<string, string>> = { name: 'NAME', date: 'DATE', size: 'SIZE' };

function fileReaderProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { postAction: afterProcessingAction(propsNode), ...localDirectory(propsNode) };
  const filter = getString(propsNode, 'fileFilter');
  if (filter) result['fileFilter'] = filter;
  const moveTo = getString(propsNode, 'moveToDirectory');
  // On a remote scheme with no connector here, the move-to folder is on the partner's server: no local move.
  if (fileScheme(propsNode) !== 'FILE') {
    if (result['postAction'] === 'MOVE') result['postAction'] = 'NONE';
  } else if (moveTo) {
    result['moveToDirectory'] = moveTo;
  }
  const sortBy = FILE_SORT_ORDER[getString(propsNode, 'sortBy') ?? ''];
  if (sortBy) result['sortBy'] = sortBy;
  if (getString(propsNode, 'checkFileAge') !== null) result['checkFileAge'] = getBoolean(propsNode, 'checkFileAge', true);
  const fileAge = getNumber(propsNode, 'fileAge', -1);
  if (Number.isInteger(fileAge) && fileAge >= 0) result['fileAgeMs'] = fileAge;
  if (getString(propsNode, 'binary') !== null) result['binary'] = getBoolean(propsNode, 'binary', false);
  return { ...result, ...mirthCharset(propsNode) };
}

function fileWriterProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    appendMode: getBoolean(propsNode, 'outputAppend', true),
    tempFileEnabled: getBoolean(propsNode, 'temporary', false),
    binary: getBoolean(propsNode, 'binary', false),
    ...localDirectory(propsNode),
  };
  const pattern = outputFileName(propsNode);
  if (pattern) result['outputPattern'] = pattern;
  return { ...result, ...mirthCharset(propsNode), ...sendTemplate(propsNode, 'template') };
}

function fileScheme(propsNode: Record<string, unknown>): string {
  return ((getString(propsNode, 'scheme') ?? '').trim() || 'FILE').toUpperCase();
}

/**
 * A remote scheme with no connector here (FTP, SMB, S3, WebDAV) gets no folder, so the
 * deploy refuses it rather than writing to a local folder named after the server.
 */
function localDirectory(propsNode: Record<string, unknown>): Record<string, unknown> {
  const dir = getString(propsNode, 'host');
  return dir && fileScheme(propsNode) === 'FILE' ? { directory: dir } : {};
}

function failsOnExistingFile(propsNode: Record<string, unknown>): boolean {
  return !getBoolean(propsNode, 'outputAppend', true) && getBoolean(propsNode, 'errorOnExists', false);
}

function fileConnectorWarnings(propsNode: Record<string, unknown>, properties: Record<string, unknown>, connector: string, channelName: string): string[] {
  const prefix = `Channel "${channelName}": the ${connector}`;
  return [...fileReaderWarnings(propsNode, prefix), ...fileWriterWarnings(propsNode, properties, prefix), ...fileEncodingWarnings(propsNode, properties, prefix)];
}

function mirthCharsetName(propsNode: Record<string, unknown>): string {
  return getString(propsNode, 'charsetEncoding')?.trim() ?? '';
}

function charsetWarnings(propsNode: Record<string, unknown>, properties: Record<string, unknown>, prefix: string, binary: boolean): string[] {
  const warnings: string[] = [];
  if (!binary && mirthCharsetName(propsNode) === 'DEFAULT_ENCODING') {
    warnings.push(`${prefix} used the Mirth server's default charset (often windows-1252 on Windows before Java 18); GalvaniGraph reads and writes UTF-8 unless a charset is set`);
  }
  const charset = properties['charset'];
  if (typeof charset === 'string' && !charsetSchema.safeParse(charset).success) {
    warnings.push(`${prefix} reads and writes ${charset}, which GalvaniGraph does not have (UTF-8, ISO-8859-1, US-ASCII and UTF-16LE only); it will not deploy until the charset is changed`);
  }
  return warnings;
}

function tcpEncodingWarnings(propsNode: Record<string, unknown>, properties: Record<string, unknown>, connector: string, channelName: string): string[] {
  const prefix = `Channel "${channelName}": the ${connector}`;
  const binary = getBoolean(propsNode, 'dataTypeBinary', false);
  const warnings = charsetWarnings(propsNode, properties, prefix, binary);
  if (binary) warnings.push(`${prefix} handles binary data in Mirth, which scripts see as base64; GalvaniGraph reads and writes it as text`);
  return warnings;
}

function fileEncodingWarnings(propsNode: Record<string, unknown>, properties: Record<string, unknown>, prefix: string): string[] {
  const binary = getBoolean(propsNode, 'binary', false);
  const mirthName = mirthCharsetName(propsNode);
  const warnings = charsetWarnings(propsNode, properties, prefix, binary);
  if (fileScheme(propsNode) !== 'SFTP') return warnings;
  if (binary) warnings.push(`${prefix} reads or writes files as binary in Mirth; the SFTP connector handles text only`);
  const writerCharset = mirthCharset(propsNode)['charset'];
  if (!('afterProcessing' in properties) && writerCharset !== undefined && writerCharset !== 'utf-8') {
    warnings.push(`${prefix} writes ${mirthName} in Mirth; the SFTP Writer writes UTF-8 only`);
  }
  return warnings;
}

/** A bound that is not a number is a reference Mirth fills. */
function skipsFilesBySize(propsNode: Record<string, unknown>): boolean {
  const bound = (key: string): string => (getString(propsNode, key) ?? '').trim();
  const minimum = bound('fileSizeMinimum');
  return (minimum !== '' && Number(minimum) !== 0) || (bound('fileSizeMaximum') !== '' && !getBoolean(propsNode, 'ignoreFileSizeMaximum', true));
}

function fileReaderWarnings(propsNode: Record<string, unknown>, prefix: string): string[] {
  const warnings: string[] = [];
  const regex = getBoolean(propsNode, 'regex', false);
  if (regex) warnings.push(`${prefix}'s file filter is a regular expression, and GalvaniGraph reads it as a glob (* and ?); rewrite it before deploying`);
  if (!regex && (getString(propsNode, 'fileFilter') ?? '').includes(',')) {
    warnings.push(`${prefix}'s file filter is a comma-separated list, which Mirth splits; GalvaniGraph reads it as one glob, so it matches nothing until it is one pattern`);
  }
  if (getBoolean(propsNode, 'directoryRecursion', false)) warnings.push(`${prefix} also reads subfolders in Mirth; GalvaniGraph reads only the folder itself`);
  if (skipsFilesBySize(propsNode)) {
    warnings.push(`${prefix} skips files outside a file size range in Mirth; GalvaniGraph reads files of every size`);
  }
  const rename = getString(propsNode, 'moveToFileName');
  if (rename && mirthAction(propsNode) === 'MOVE') {
    warnings.push((getString(propsNode, 'moveToDirectory') ?? '').trim() === ''
      ? `${prefix} renames each file in place to "${rename}" in Mirth; GalvaniGraph cannot rename, so it will not deploy until a move-to folder is set or the action is changed`
      : `${prefix} renames the files it moves to "${rename}" in Mirth; GalvaniGraph keeps their names`);
  }
  for (const key of ['errorReadingAction', 'errorResponseAction'] as const) {
    if ((getString(propsNode, key) ?? '').toUpperCase() === 'MOVE') {
      warnings.push(`${prefix} moves a file whose ${key === 'errorReadingAction' ? 'reading' : 'message'} fails to an error folder in Mirth; GalvaniGraph does not move it`);
    }
  }
  return warnings;
}

function fileWriterWarnings(propsNode: Record<string, unknown>, properties: Record<string, unknown>, prefix: string): string[] {
  const warnings: string[] = [];
  const pattern = properties['outputPattern'] ?? properties['fileNameTemplate'];
  const unknown = typeof pattern === 'string' ? unknownPlaceholders(pattern) : [];
  if (unknown.length > 0) {
    warnings.push(`${prefix}'s file name uses ${unknown.map((n) => '${' + n + '}').join(', ')}, which GalvaniGraph cannot fill (only \${messageId} and \${timestamp}); it will not deploy unless it names a configuration map entry`);
  }
  if (failsOnExistingFile(propsNode)) {
    warnings.push(`${prefix} fails in Mirth when its file already exists; GalvaniGraph has no such check and would overwrite the file`);
  }
  return warnings;
}

/**
 * Settings with no safe equivalent here, for which the channel is imported
 * disabled so that someone decides before it runs.
 */
function disablingSettings(mirthChannel: Record<string, unknown>): string[] {
  // A destination disabled in Mirth never sends, so nothing of it can lose or change data.
  const destinations = destinationConnectorsById(mirthChannel).map(([, dest]) => dest).filter((dest) => getBoolean(dest, 'enabled', true));
  return [...sourceHolds(mirthChannel), ...attachmentHolds(mirthChannel, destinations), ...destinations.flatMap(destinationHolds)];
}

function sourceHolds(mirthChannel: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const source = getNestedRecord(mirthChannel, 'sourceConnector') ?? {};
  const propsNode = getNestedRecord(source, 'properties') ?? {};
  const pollingType = mirthPollingType(getNestedRecord(propsNode, 'pollConnectorProperties'));
  if (pollingType === 'TIME' || pollingType === 'CRON') {
    reasons.push('its source polls on a schedule (time of day or cron) and would poll at an interval here');
  }
  const type = connectorType(source);
  if (type === 'TCP_MLLP' && getBoolean(propsNode, 'dataTypeBinary', false)) {
    reasons.push('its TCP Listener receives binary data, which GalvaniGraph reads as text');
  }
  if (type === 'FILE' && binaryOverSftp(propsNode)) {
    reasons.push('its File Reader reads binary files over SFTP, which GalvaniGraph reads as text');
  }
  if (type === 'FILE' && skipsFilesBySize(propsNode)) {
    reasons.push('its File Reader skips files outside a file size range in Mirth and would read them here, and delete or move them when it does that to what it reads');
  }
  return reasons;
}

function binaryOverSftp(propsNode: Record<string, unknown>): boolean {
  return fileScheme(propsNode) === 'SFTP' && getBoolean(propsNode, 'binary', false);
}

/** Mirth's names for the text a destination sends instead of the encoded message. */
const TEMPLATE_KEYS: ReadonlyMap<string, string> = new Map([['TCP_MLLP', 'template'], ['HTTP', 'content'], ['FILE', 'template'], ['CHANNEL', 'channelTemplate']]);

/** Names a template fills here with something else than Mirth does. */
function templateHolds(dest: Record<string, unknown>, propsNode: Record<string, unknown>, name: string): string[] {
  const text = getString(propsNode, TEMPLATE_KEYS.get(connectorType(dest) ?? '') ?? '') ?? '';
  const names = referenceNames(text);
  const uses = (reference: string): boolean => names.includes(reference);
  return [
    ...(uses('message.rawData') && transforms(dest)
      ? [`the template of "${name}" uses \${message.rawData}, which is the message after the source transformer in Mirth and the message as it was received here`] : []),
    ...(uses('message.transformedData')
      ? [`the template of "${name}" uses \${message.transformedData}, which is Mirth's internal form of the message (XML for HL7) and the outbound message here`] : []),
  ];
}

function destinationHolds(dest: Record<string, unknown>): string[] {
  const propsNode = getNestedRecord(dest, 'properties') ?? {};
  const name = getString(dest, 'name') ?? '';
  const reasons: string[] = [];
  if (failsOnExistingFile(propsNode)) reasons.push(`the File Writer "${name}" must not overwrite an existing file`);
  const type = connectorType(dest);
  if (type === 'TCP_MLLP' && getBoolean(propsNode, 'dataTypeBinary', false)) {
    reasons.push(`the TCP Sender "${name}" sends binary data, which GalvaniGraph writes as text`);
  }
  if (type === 'TCP_MLLP' && getBoolean(propsNode, 'ignoreResponse', false) && convertQueueSettings(dest, propsNode).queueMode !== 'NEVER') {
    reasons.push(`the TCP Sender "${name}" ignores the answer in Mirth, and its queue would send a message again until it gets one here`);
  }
  if (type === 'FILE' && binaryOverSftp(propsNode)) {
    reasons.push(`the File Writer "${name}" writes binary files over SFTP, which GalvaniGraph writes as text`);
  }
  const smtp = type === 'SMTP' ? smtpHold(propsNode, name) : null;
  if (smtp) reasons.push(smtp);
  reasons.push(...templateHolds(dest, propsNode, name));
  return [...reasons, ...responseTransformer(dest).holds];
}

/** In the description, so the editor shows why the import disabled the channel and an export carries it. */
function withHoldNote(description: string | null, holds: readonly string[]): string | null {
  if (holds.length === 0) return description;
  const note = `Imported disabled from Mirth: ${holds.join('; ')}. Enable it once you have decided how it should run here.`;
  return description ? `${description}\n\n${note}` : note;
}

/** Mirth 3.0 to 3.2 write `interval` in lower case. */
function mirthPollingType(poll: Record<string, unknown> | null): string {
  return (getString(poll ?? {}, 'pollingType') ?? 'INTERVAL').toUpperCase();
}

/**
 * Only Mirth's INTERVAL polling has an equivalent; time-of-day and cron polling keep the
 * connector's default interval.
 */
function pollingInterval(propsNode: Record<string, unknown>): Record<string, unknown> {
  const poll = getNestedRecord(propsNode, 'pollConnectorProperties');
  if (!poll || mirthPollingType(poll) !== 'INTERVAL') return {};
  const ms = getNumber(poll, 'pollingFrequency', 0);
  return ms > 0 ? { pollingIntervalMs: ms } : {};
}

function pollingWarning(propsNode: Record<string, unknown>, channelName: string): string | null {
  const poll = getNestedRecord(propsNode, 'pollConnectorProperties');
  if (!poll) return null;
  const type = mirthPollingType(poll);
  const prefix = `Channel "${channelName}": the source polls`;
  const fallback = "; GalvaniGraph polls only at an interval, so it imported with the connector's default interval. Set its polling interval before deploying";
  if (type === 'TIME') {
    const at = (key: string): string => String(getNumber(poll, key, 0)).padStart(2, '0');
    return `${prefix} once a day at ${at('pollingHour')}:${at('pollingMinute')} in Mirth${fallback}`;
  }
  if (type === 'CRON') {
    const cron = getNestedRecord(poll, 'cronJobs') ?? {};
    const expressions = toRecordList(cron['cronProperty']).map((job) => getString(job, 'expression') ?? '').filter((e) => e !== '');
    return `${prefix} on the cron schedule ${expressions.map((e) => `"${e}"`).join(', ')} in Mirth${fallback}`;
  }
  return limitedPolling(getNestedRecord(poll, 'pollConnectorPropertiesAdvanced'))
    ? `${prefix} only on some days or hours in Mirth (its advanced polling settings); GalvaniGraph polls at its interval all day, every day`
    : null;
}

/** True when Mirth's advanced polling settings leave out some days (weekly or monthly) or hours. */
function limitedPolling(advanced: Record<string, unknown> | null): boolean {
  if (!advanced) return false;
  const days = getNestedRecord(advanced, 'inactiveDays') ?? {};
  const raw = days['boolean'];
  const inactive: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
  return !getBoolean(advanced, 'weekly', true) || !getBoolean(advanced, 'allDay', true) || inactive.some((d) => String(d) === 'true');
}

function mapTransportName(transportName: string, channelName: string, warnings: string[]): string {
  const mapped = connectorTypeOfTransport(transportName);
  if (mapped) return mapped;
  warnings.push(`Channel "${channelName}": Unknown transport name "${transportName}", defaulting to JAVASCRIPT`);
  return 'JAVASCRIPT';
}

function extractConnectorProperties(propsNode: Record<string, unknown>, connectorType: string, direction: 'source' | 'destination'): Record<string, unknown> {
  const result: Record<string, unknown> = {};

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
      if (remotePort) result['port'] = portValue(remotePort);
      Object.assign(result, sendTemplate(propsNode, 'template'), tcpFraming(propsNode), mirthCharset(propsNode));
      break;
    }
    case 'HTTP': {
      const listener = getNestedRecord(propsNode, 'listenerConnectorProperties');
      if (listener) {
        const host = getString(listener, 'host');
        const port = getString(listener, 'port');
        if (host) result['host'] = host;
        if (port) result['port'] = portValue(port);
        Object.assign(result, httpListenerProperties(propsNode));
      }
      const url = getString(propsNode, 'host');
      if (url) result['url'] = url;
      if (!listener) Object.assign(result, sendTemplate(propsNode, 'content'), httpSenderProperties(propsNode));
      break;
    }
    case 'FILE':
      Object.assign(result, direction === 'source' ? fileReaderProperties(propsNode) : fileWriterProperties(propsNode));
      break;
    case 'DATABASE':
      Object.assign(result, databaseProperties(propsNode));
      break;
    case 'SMTP':
      Object.assign(result, smtpProperties(propsNode));
      break;
    case 'CHANNEL': {
      // Channel Writer: the target is the Mirth channel id, which the import
      // keeps as the channel's id (in lower case, D-349). "none" is Mirth's "no channel selected".
      const target = getString(propsNode, 'channelId');
      if (target !== null) result['targetChannelId'] = target === 'none' ? '' : idSchema.safeParse(target).data ?? target;
      Object.assign(result, sendTemplate(propsNode, 'channelTemplate'));
      break;
    }
    case 'JAVASCRIPT': {
      const script = getString(propsNode, 'script');
      if (script) result['script'] = script;
      break;
    }
    case 'DICOM':
      Object.assign(result, direction === 'source' ? dicomListenerProperties(propsNode) : dicomSenderProperties(propsNode));
      break;
    default:
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
 * A Mirth `linked-hash-map` of name to list of values. A name with several
 * values keeps them joined with ", ", as one HTTP header carries them.
 */
function linkedMap(node: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isPlainObject(node)) return result;
  for (const entry of toRecordList(node['entry'])) {
    const name = getString(entry, 'string');
    if (name) result[name] = stringList(entry['list']).join(', ');
  }
  return result;
}

function httpSenderProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    method: (getString(propsNode, 'method') ?? 'post').toUpperCase(),
    headers: linkedMap(propsNode['headers']),
    parameters: linkedMap(propsNode['parameters']),
  };
  const contentType = getString(propsNode, 'contentType');
  if (contentType) result['contentType'] = contentType;
  if (getBoolean(propsNode, 'useAuthentication', false) && getString(propsNode, 'authenticationType') === 'Basic') {
    result['basicAuth'] = { username: getString(propsNode, 'username') ?? '', password: getString(propsNode, 'password') ?? '' };
  }
  return result;
}

function httpDigestWarning(propsNode: Record<string, unknown>, connector: string, channelName: string): string | null {
  if (!getBoolean(propsNode, 'useAuthentication', false) || getString(propsNode, 'authenticationType') !== 'Digest') return null;
  return `Channel "${channelName}": the ${connector} uses Digest authentication, which GalvaniGraph does not have; its credentials were dropped, so requests go without them. Build the Authorization header in a JavaScript writer`;
}

/** Mirth's names for two values that an email's texts can use. */
const MIRTH_SMTP_VALUES: Readonly<Record<string, string>> = { 'message.encodedData': 'msg', 'message.messageId': 'messageId' };
const SMTP_TEXTS: ReadonlySet<string> = new Set(['subject', 'bodyTemplate']);

function smtpProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const port = getString(propsNode, 'smtpPort');
  if (port) result['port'] = portValue(port);
  const fields = [['smtpHost', 'host'], ['to', 'to'], ['from', 'from'], ['cc', 'cc'], ['bcc', 'bcc'], ['subject', 'subject'], ['body', 'bodyTemplate']] as const;
  for (const [from, to] of fields) {
    const value = getString(propsNode, from);
    // An empty body is what Mirth sends then; with none, GalvaniGraph would send the message.
    if (value || (to === 'bodyTemplate' && value !== null)) result[to] = SMTP_TEXTS.has(to) ? renameReferences(value, MIRTH_SMTP_VALUES) : value;
  }
  const attachments = smtpTextAttachments(propsNode).map((a) => ({
    ...a, filename: renameReferences(a.filename, MIRTH_SMTP_VALUES), content: renameReferences(a.content, MIRTH_SMTP_VALUES),
  }));
  if (attachments.length > 0) result['attachments'] = attachments;
  if (getBoolean(propsNode, 'html', false)) result['contentType'] = 'text/html';
  const encryption = getString(propsNode, 'encryption')?.toLowerCase();
  if (encryption === 'ssl') result['secure'] = true;
  if (encryption === 'tls') result['requireTLS'] = true;
  if (getBoolean(propsNode, 'authentication', false)) {
    result['authUser'] = getString(propsNode, 'username') ?? '';
    result['authPass'] = getString(propsNode, 'password') ?? '';
  }
  return result;
}

/**
 * The files always stay (`postAction` NONE), never the DICOM source's default DELETE: a
 * message here is the file's path, so a queued Sender or a reprocess needs the file after the
 * source is done.
 */
function dicomListenerProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { postAction: 'NONE' };
  const port = getString(getNestedRecord(propsNode, 'listenerConnectorProperties') ?? {}, 'port');
  if (port) result['port'] = portValue(port);
  const dest = getString(propsNode, 'dest');
  if (dest) result['storageDir'] = dest;
  const aeTitle = getString(propsNode, 'applicationEntity');
  if (aeTitle) result['aeTitle'] = aeTitle;
  return { ...result, ...dicomTls(propsNode) };
}

/** Kept so the DICOM schema refuses it: the connector has no TLS, so the channel must not run in plaintext (D-274). */
function dicomTls(propsNode: Record<string, unknown>): Record<string, unknown> {
  const tls = getString(propsNode, 'tls') ?? 'notls';
  return tls === 'notls' || tls === '' ? {} : { tls };
}

/**
 * Blank AE titles become the ones Mirth sends then (`DCMRCV`, and dcm4che's `DCMSND`), not
 * the DICOM destination's own defaults.
 */
function dicomSenderProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    calledAETitle: getString(propsNode, 'applicationEntity') || 'DCMRCV',
    callingAETitle: getString(propsNode, 'localApplicationEntity') || 'DCMSND',
  };
  const host = getString(propsNode, 'host');
  if (host) result['host'] = host;
  const port = getString(propsNode, 'port');
  if (port) result['port'] = portValue(port);
  return { ...result, ...dicomTls(propsNode) };
}

function dicomWarnings(propsNode: Record<string, unknown>, direction: 'source' | 'destination', connector: string, channelName: string): string[] {
  const prefix = `Channel "${channelName}": the ${connector}`;
  const warnings: string[] = [];
  if ((getString(propsNode, 'tls') ?? 'notls') !== 'notls') {
    warnings.push(`${prefix} uses TLS in Mirth; GalvaniGraph's DICOM connector has no TLS, so it will not deploy rather than send in plaintext. Tunnel the link and import it with TLS off`);
  }
  if (direction === 'source') {
    warnings.push(`${prefix}'s messages are a file path here (the stored object's file), not the DICOM object; scripts read its tags from the source map`);
    if (!getString(propsNode, 'dest')) warnings.push(`${prefix} stores no files in Mirth; set storageDir, the folder received objects are written to, before deploying`);
    return warnings;
  }
  const template = getString(propsNode, 'template') ?? '';
  const dropped = [
    ...(template.trim() !== '' && template.trim() !== '${DICOMMESSAGE}' ? ['its template (it sends the file the message names)'] : []),
    ...(getString(propsNode, 'username') || getString(propsNode, 'passcode') ? ['user identity'] : []),
    ...(getBoolean(propsNode, 'stgcmt', false) ? ['storage commitment'] : []),
  ];
  if (dropped.length > 0) warnings.push(`${prefix} uses ${dropped.join(', ')}, which GalvaniGraph's DICOM connector does not have; dropped`);
  return warnings;
}

/** `jdbc:<vendor>://host[:port]/database[?options]` */
const JDBC_URL = /^jdbc:(\w+):\/\/([^:/?;]+)(?::(\d+|\$\{[^}]+\}))?\/([^?;]+)/;

/** `jdbc:sqlserver://host[\instance][:port][;databaseName=name;...]` */
const SQLSERVER_URL = /^jdbc:sqlserver:\/\/([^:;/]+)(?::(\d+|\$\{[^}]+\}))?/i;

/** The database a SQL Server URL names in its `;databaseName=` (or `;database=`) property. */
const SQLSERVER_DATABASE = /;(?:databaseName|database)=([^;]+)/i;

const RUNNABLE_DB_VENDORS: ReadonlySet<string> = new Set(Object.values(DATABASE_VENDOR));

/** A `${...}` part stays as written, a port too, for the deploy to resolve from the configuration map. */
function jdbcLocation(url: string): Record<string, unknown> {
  if (unreadableUrl(url)) return {};
  const standard = JDBC_URL.exec(url);
  if (standard) return { host: standard[2], ...(standard[3] ? { port: portValue(standard[3]) } : {}), database: standard[4] };
  const sqlServer = SQLSERVER_URL.exec(url);
  if (!sqlServer) return {};
  const database = SQLSERVER_DATABASE.exec(url)?.[1];
  return { host: sqlServer[1], ...(sqlServer[2] ? { port: portValue(sqlServer[2]) } : {}), ...(database ? { database } : {}) };
}

/** MySQL Connector/J's `jdbc:mysql:loadbalance://` and `jdbc:mysql:replication://` URLs. */
const MYSQL_MULTI_HOST_MODE = /^jdbc:mysql:(loadbalance|replication):\/\//i;

/** A JDBC URL whose host part lists several hosts (`//h1,h2/db`). */
const MULTI_HOST_URL = /^jdbc:[\w:]+\/\/[^/?;]*,/i;

/** The text never quotes the URL, which can carry credentials, except a bare `${...}`. */
function unreadableUrl(url: string): string | null {
  if (!/^jdbc:/i.test(url) && url.includes('${')) return `URL is the reference ${url}, whose database type, host, port and database the import cannot read`;
  const mode = MYSQL_MULTI_HOST_MODE.exec(url)?.[1]?.toLowerCase();
  if (mode) return `URL uses MySQL's ${mode} mode over several hosts, which GalvaniGraph does not have`;
  if (MULTI_HOST_URL.test(url)) return 'URL lists several hosts, and GalvaniGraph connects to one';
  if (url.includes('${') && !JDBC_URL.test(url) && !SQLSERVER_URL.test(url)) {
    // Name only the references: the rest of a URL can carry credentials.
    return `URL uses ${(url.match(/\$\{[^}]+\}/g) ?? []).join(', ')} where the import needs a host and a database, so it cannot read them`;
  }
  return null;
}

function databaseWarnings(propsNode: Record<string, unknown>, vendor: unknown, connector: string, channelName: string): string[] {
  const warnings: string[] = [];
  const unreadable = unreadableUrl(getString(propsNode, 'url') ?? '');
  if (unreadable) {
    warnings.push(`Channel "${channelName}": the ${connector}'s ${unreadable}; fill in the database type, host, port and database by hand before deploying`);
  }
  if (typeof vendor === 'string' && !RUNNABLE_DB_VENDORS.has(vendor)) {
    warnings.push(`Channel "${channelName}": the ${connector} uses ${vendor}, which GalvaniGraph cannot connect to (PostgreSQL and MySQL/MariaDB only); it will not deploy`);
  }
  if (getBoolean(propsNode, 'useScript', false)) {
    warnings.push(`Channel "${channelName}": the ${connector} uses Mirth's JavaScript mode, which GalvaniGraph does not have; its script was copied into the SQL query field and will fail as SQL. Rewrite it as SQL or use a JavaScript connector`);
  }
  return warnings;
}

/** Mirth's Database Reader update modes: 1 never, 2 once after all rows, 3 after each row. */
const DB_UPDATE_MODE: Readonly<Record<string, string>> = { '1': 'NEVER', '2': 'ALWAYS', '3': 'ON_SUCCESS' };

/**
 * The vendor is the URL's scheme (MariaDB speaks MySQL's protocol). One with no driver here
 * (sqlserver, oracle) is kept, so the deploy refuses it by name and the preview warns (see
 * {@link databaseWarnings}). Queries keep their `${name}` parameters, which bind from the
 * row (reader) or the message's variables (writer).
 */
function databaseProperties(propsNode: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const url = getString(propsNode, 'url') ?? '';
  const scheme = /^jdbc:(\w+):/.exec(url)?.[1]?.toLowerCase();
  if (scheme) result['vendor'] = scheme === 'mariadb' ? 'mysql' : scheme;
  Object.assign(result, jdbcLocation(url));
  for (const [from, to] of [['username', 'username'], ['password', 'password'], ['query', 'query'], ['select', 'selectQuery'], ['update', 'updateQuery']] as const) {
    const value = getString(propsNode, from);
    if (value) result[to] = value;
  }
  const updateMode = DB_UPDATE_MODE[getString(propsNode, 'updateMode') ?? ''];
  if (updateMode && result['selectQuery'] !== undefined) result['updateMode'] = updateMode;
  return result;
}

/** The encoded message itself needs no template. A blank one sends nothing, as in Mirth: with none, the whole message would go. */
function sendTemplate(propsNode: Record<string, unknown>, key: string): Record<string, unknown> {
  const template = getString(propsNode, key);
  if (template === null || template.trim() === '${message.encodedData}') return {};
  return { template: renameReferences(template, { 'message.messageId': 'messageId' }) };
}

function tcpFraming(propsNode: Record<string, unknown>): Record<string, unknown> {
  const mode = getNestedRecord(propsNode, 'transmissionModeProperties') ?? {};
  const start = (getString(mode, 'startOfMessageBytes') ?? '0B').toUpperCase();
  const end = (getString(mode, 'endOfMessageBytes') ?? '1C0D').toUpperCase();
  return start === '0B' && end === '1C0D' ? {} : { frameStart: start, frameEnd: end };
}

/** A port as a number, or as written when it is a `${...}` reference resolved at deploy. */
function portValue(port: string): number | string {
  return /^\d+$/.test(port.trim()) ? Number(port) : port;
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

/**
 * The listener's `charset` is no guide to its request bodies, so it does not set
 * `bodyCharset`: Mirth encodes responses in it, and reads a body in the charset the
 * request declares, else as UTF-8 for JSON and ISO-8859-1 for the rest.
 */
function httpListenerWarnings(propsNode: Record<string, unknown>, channelName: string): string[] {
  const prefix = `Channel "${channelName}": the HTTP Listener`;
  const warnings = [`${prefix} refuses (415) text that is not UTF-8 unless its charset is declared or bodyCharset is set; Mirth reads it as ISO-8859-1`];
  if ((getString(propsNode, 'binaryMimeTypes') ?? '').trim() !== '') {
    warnings.push(`${prefix} keeps binary bodies as base64 in Mirth; GalvaniGraph refuses them (415) unless bodyCharset is base64, which applies to every body`);
  }
  return warnings;
}

interface ChannelContext extends WarningSink {
  readonly inboundDataType: string;
}

function convertDestinations(
  mirthChannel: Record<string, unknown>,
  context: ChannelContext,
): ChannelExportEntry['destinations'] {
  const destinationConnectors = mirthChannel['destinationConnectors'];
  if (!isPlainObject(destinationConnectors) && !Array.isArray(destinationConnectors)) return [];

  let connectorList: readonly Record<string, unknown>[];
  if (Array.isArray(destinationConnectors)) {
    connectorList = destinationConnectors.filter(isPlainObject);
  } else {
    const inner = destinationConnectors['connector'];
    if (Array.isArray(inner)) {
      connectorList = inner.filter(isPlainObject);
    } else if (isPlainObject(inner)) {
      connectorList = [inner];
    } else {
      return [];
    }
  }

  return connectorList.map((dest, idx) => convertDestination(dest, idx, context));
}

function convertDestination(dest: Record<string, unknown>, idx: number, context: ChannelContext): ChannelExportEntry['destinations'][number] {
  const { channelName, warnings } = context;
  const propsNode = isPlainObject(dest['properties'])
    ? dest['properties'] as Record<string, unknown>
    : {};
  const className = typeof propsNode['@_class'] === 'string' ? propsNode['@_class'] : null;
  const transportName = getString(dest, 'transportName');
  const resolved = resolveConnectorType(className, channelName, warnings);
  const mirthType = destinationTypeFor(
    resolved === 'JAVASCRIPT' && transportName ? mapTransportName(transportName, channelName, warnings) : resolved,
    channelName,
    warnings,
  );

  const remote = remoteFileConnector(mirthType, propsNode, 'destination', channelName, warnings);
  const name = getString(dest, 'name') ?? `Destination ${idx + 1}`;
  const type = remote?.type ?? mirthType;
  const label = `${transportName ?? mirthType} "${name}"`;
  const properties = withRawDataRenamed(remote?.properties ?? extractConnectorProperties(propsNode, mirthType, 'destination'), dest);
  const queue = convertQueueSettings(dest, propsNode);
  const queued = queue.queueMode !== 'NEVER';
  warnings.push(...destinationSettingWarnings({ type: mirthType, propsNode, properties, name, queued }, channelName));
  warnings.push(...referenceWarnings({ type, direction: 'destination', label, properties }, channelName));
  warnings.push(...queueWarnings(type, queue).map((w) => `Channel "${channelName}": destination "${name}" ${w}`));
  const response = responseTransformer(dest);
  warnings.push(...responseTransformerWarnings(response, {
    channelName, destination: name, queued, dataType: context.inboundDataType,
  }));
  return {
    metaDataId: destinationMetaDataId(dest, idx),
    name,
    enabled: getBoolean(dest, 'enabled', true),
    connectorType: type,
    properties,
    ...queue,
    // Mirth's queue gives up on no message it could not send, and 0 is that here (D-230).
    retryCount: queued ? 0 : queue.retryCount,
    waitForPrevious: getBoolean(dest, 'waitForPrevious', false),
    ...(response.script === null ? {} : { responseTransformer: response.script }),
  };
}

/** Mirth's raw data of a destination is the message it gets, which is the one it sends when it changes nothing (else see {@link templateHolds}). */
function withRawDataRenamed(properties: Record<string, unknown>, dest: Record<string, unknown>): Record<string, unknown> {
  const template = getString(properties, 'template');
  return template === null || transforms(dest) ? properties
    : { ...properties, template: renameReferences(template, { 'message.rawData': 'message.encodedData' }) };
}

function tcpAnswerWarnings(propsNode: Record<string, unknown>, queued: boolean, prefix: string): string[] {
  if (getBoolean(propsNode, 'ignoreResponse', false)) {
    return [`${prefix} ignores the answer in Mirth; GalvaniGraph waits for an acknowledgement, and a message that gets none is an ERROR or is sent again by its queue`];
  }
  return !queued || getBoolean(propsNode, 'queueOnResponseTimeout', true) ? []
    : [`${prefix} does not queue a message again in Mirth when it gets no answer in time; GalvaniGraph's queue sends it again`];
}

interface ConvertedDestination {
  readonly type: string;
  readonly propsNode: Record<string, unknown>;
  readonly properties: Record<string, unknown>;
  readonly name: string;
  readonly queued: boolean;
}

function destinationSettingWarnings({ type, propsNode, properties, name, queued }: ConvertedDestination, channelName: string): string[] {
  switch (type) {
    case 'DATABASE': return databaseWarnings(propsNode, properties['vendor'], `Database Writer "${name}"`, channelName);
    case 'FILE': return fileConnectorWarnings(propsNode, properties, `File Writer "${name}"`, channelName);
    case 'DICOM': return dicomWarnings(propsNode, 'destination', `DICOM Sender "${name}"`, channelName);
    case 'TCP_MLLP': return [
      ...tcpEncodingWarnings(propsNode, properties, `TCP Sender "${name}"`, channelName),
      ...tcpAnswerWarnings(propsNode, queued, `Channel "${channelName}": the TCP Sender "${name}"`),
    ];
    case 'SMTP': return smtpWarnings(propsNode, name, channelName);
    case 'HTTP': return [httpDigestWarning(propsNode, `HTTP Sender "${name}"`, channelName) ?? []].flat();
    default: return [];
  }
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
  const settings = modern ?? getNestedRecord(dest, 'queueConnectorProperties') ?? {};
  return {
    queueMode: modern
      ? (!getBoolean(modern, 'queueEnabled', false) ? 'NEVER' : getBoolean(modern, 'sendFirst', false) ? 'ON_FAILURE' : 'ALWAYS')
      : mapQueueMode(getString(dest, 'queueMode') ?? getString(settings, 'queueEnabled')),
    retryCount: getNumber(settings, 'retryCount', 0),
    retryIntervalMs: getNumber(settings, modern ? 'retryIntervalMillis' : 'retryIntervalMs', 10000),
    rotateQueue: getBoolean(settings, 'rotate', false),
    queueThreadCount: Math.max(1, getNumber(settings, 'threadCount', 1)),
  };
}

/** `queue`: as Mirth has it, with its retry count, the attempts after the first that come before the queue. */
function queueWarnings(type: string, queue: QueueSettings): string[] {
  const times = `retries a failed message ${String(queue.retryCount)} times`;
  if (queue.queueMode === 'NEVER') {
    return queue.retryCount > 0 ? [`${times} in Mirth; with no queue GalvaniGraph tries it once, so give it a queue to have it retried`] : [];
  }
  const warnings: string[] = [];
  if (queue.retryCount > 0 && queue.queueMode === 'ON_FAILURE') {
    warnings.push(`${times} in Mirth before it queues it; GalvaniGraph queues it at the first failure and retries it from there until it is delivered`);
  }
  const behind = queue.rotateQueue ? '' : ', and the messages behind it wait';
  if (type === 'TCP_MLLP') {
    warnings.push(`ends a message in Mirth on a negative acknowledgement (as ERROR, or as SENT when it does not validate responses); here the queue sends again what the partner refuses, what gets no answer and what the charset cannot hold${behind}`);
  }
  if (type === 'JAVASCRIPT') {
    warnings.push(`ends a message as ERROR in Mirth when its script fails; here the queue runs it again until it succeeds${behind}`);
  }
  return warnings;
}

function mapQueueMode(value: string | null): string {
  if (!value) return 'NEVER';
  const upper = value.toUpperCase();
  if (upper === 'ALWAYS' || upper === 'TRUE') return 'ALWAYS';
  if (upper === 'ON_FAILURE') return 'ON_FAILURE';
  return 'NEVER';
}

function extractDataType(
  connector: Record<string, unknown> | null,
  direction: 'inbound' | 'outbound',
): string | null {
  if (!connector) return null;

  const transformer = isPlainObject(connector['transformer'])
    ? connector['transformer'] as Record<string, unknown>
    : null;
  if (!transformer) return null;

  const key = direction === 'inbound' ? 'inboundDataType' : 'outboundDataType';
  return mirthDataType(getString(transformer, key));
}

interface WarningSink {
  readonly channelName: string;
  readonly warnings: string[];
}

function convertFilters(mirthChannel: Record<string, unknown>, sink: WarningSink): ChannelExportEntry['filters'] {
  const filters: ChannelExportEntry['filters'] = [];

  const sourceFilter = extractFilterFromConnector(mirthChannel['sourceConnector'], null, sink);
  if (sourceFilter) filters.push(sourceFilter);

  for (const [metaDataId, conn] of destinationConnectorsById(mirthChannel)) {
    const filter = extractFilterFromConnector(conn, metaDataId, sink);
    if (filter) filters.push(filter);
  }

  return filters;
}

function destinationConnectorsById(mirthChannel: Record<string, unknown>): ReadonlyArray<readonly [number, Record<string, unknown>]> {
  const destConnectors = mirthChannel['destinationConnectors'];
  if (!isPlainObject(destConnectors)) return [];
  const connectorList = toRecordList(destConnectors['connector']);
  return connectorList.map((conn, idx) => [destinationMetaDataId(conn, idx), conn] as const);
}

function extractFilterFromConnector(
  connector: unknown,
  metaDataId: number | null,
  sink: WarningSink,
): ChannelExportEntry['filters'][number] | null {
  if (!isPlainObject(connector)) return null;

  const filter = filterOf(connector);
  if (!filter) return null;

  const rules = scriptElements(filter, 'rules', 'rule').map(({ className, node: rule }) => {
    const base = {
      enabled: getBoolean(rule, 'enabled', true),
      name: getString(rule, 'name'),
      operator: getString(rule, 'operator') ?? 'AND',
      type: mapFilterRuleType(className ?? getString(rule, 'type')),
      script: getString(rule, 'script'),
      field: getString(rule, 'field'),
      condition: getString(rule, 'condition'),
      values: stringList(rule['values']),
    };
    return base.type === 'RULE_BUILDER' ? { ...base, ...ruleBuilderRule(base, sink) } : base;
  });

  if (rules.length === 0) return null;

  return { connectorId: null, metaDataId, rules };
}

/** A filter rule's type: Mirth 4.x `RuleBuilderRule` and older `Rule Builder` rules are RULE_BUILDER. */
function mapFilterRuleType(type: string | null): string {
  if (!type) return 'JAVASCRIPT';
  const upper = type.toUpperCase().replace(/\s+/g, '_');
  if (upper.includes('JAVASCRIPT')) return 'JAVASCRIPT';
  if (upper === 'RULEBUILDERRULE' || upper === 'RULE_BUILDER') return 'RULE_BUILDER';
  return upper;
}

const RULE_BUILDER_CONDITION: Readonly<Record<string, string>> = {
  EXISTS: 'EXISTS', NOT_EXIST: 'NOT_EXISTS', EQUALS: 'EQUALS', NOT_EQUAL: 'NOT_EQUALS', CONTAINS: 'CONTAINS', NOT_CONTAIN: 'NOT_CONTAINS',
};

type RuleBuilderFields = Pick<ChannelExportEntry['filters'][number]['rules'][number], 'type' | 'script' | 'field' | 'condition' | 'values'>;

interface MirthRule {
  readonly enabled: boolean;
  readonly name: string | null;
  readonly script: string | null;
  readonly field: string | null;
  readonly condition: string | null;
  readonly values: readonly string[];
}

/**
 * A Mirth Rule Builder rule, whose field and values are JavaScript
 * expressions. An MSH field (`msg['MSH']['MSH.9']['MSH.9.1'].toString()`)
 * compared with quoted text becomes an engine Rule Builder rule, with no
 * values read as Mirth's comparison with empty text; any other expression
 * becomes the JavaScript Mirth itself generates, which the script check reads
 * like any other. A legacy rule that carries only its generated script keeps
 * it. An enabled rule with no field or an unknown condition stays a Rule
 * Builder rule the deploy refuses, with a preview warning.
 */
function ruleBuilderRule(rule: MirthRule, sink: WarningSink): RuleBuilderFields {
  const field = rule.field?.trim() ?? '';
  if (field === '' && rule.script) return { type: 'JAVASCRIPT', script: rule.script, field: null, condition: null, values: [] };
  const condition = RULE_BUILDER_CONDITION[rule.condition ?? ''];
  if (field === '' || condition === undefined) {
    if (rule.enabled) {
      sink.warnings.push(`Channel "${sink.channelName}": Rule Builder rule "${rule.name ?? ''}" has ${field === '' ? 'no field' : `the unknown condition "${rule.condition ?? ''}"`}; it will not deploy until it is rewritten`);
    }
    return { type: 'RULE_BUILDER', script: null, field, condition: rule.condition, values: [...rule.values] };
  }
  const path = hl7FieldPath(field);
  const texts = rule.values.map(quotedText);
  const literals = texts.filter((t): t is string => t !== null);
  if (path !== null && literals.length === texts.length) {
    const values = condition.endsWith('EXISTS') ? [] : literals.length > 0 ? literals : [''];
    return { type: 'RULE_BUILDER', script: null, field: path, condition, values };
  }
  return { type: 'JAVASCRIPT', script: mirthRuleScript(field, rule.condition ?? '', rule.values), field: null, condition: null, values: [] };
}

/** `msg['SEG']['SEG.n']...` with an optional `.toString()`: the bracketed names. */
const E4X_FIELD = /^msg((?:\[\s*(?:'[^'\\]+'|"[^"\\]+")\s*\])+)(?:\.toString\(\))?$/;

/**
 * The HL7 path (`MSH.9.1`) of an E4X field in MSH, or null. Only MSH: it
 * occurs once and its fields do not repeat, so the engine's first-occurrence
 * read agrees with Mirth's. In other segments a segment or field can repeat,
 * where Mirth's comparison sees every repetition.
 */
function hl7FieldPath(field: string): string | null {
  const brackets = E4X_FIELD.exec(field)?.[1];
  if (brackets === undefined) return null;
  const names = [...brackets.matchAll(/\[\s*['"]([^'"]+)['"]\s*\]/g)].map((m) => m[1] ?? '');
  const last = names[names.length - 1] ?? '';
  return names[0] === 'MSH' && last.startsWith('MSH.') ? last : null;
}

function quotedText(value: string): string | null {
  return /^(['"])([^'"\\]*)\1$/.exec(value.trim())?.[2] ?? null;
}

/** The script Mirth's RuleBuilderRule.getScript generates for a field, condition and values. */
function mirthRuleScript(field: string, condition: string, values: readonly string[]): string {
  const negated = condition.startsWith('NOT_');
  const join = negated ? ' && ' : ' || ';
  let test: string;
  if (condition === 'EXISTS' || condition === 'NOT_EXIST') {
    test = `${field}.length ${negated ? '==' : '>'} 0`;
  } else if (condition === 'CONTAINS' || condition === 'NOT_CONTAIN') {
    const eq = negated ? '==' : '!=';
    test = values.length > 0 ? values.map((v) => `(${field}.indexOf(${v}) ${eq} -1)`).join(join) : `${field}.indexOf("") ${eq} -1`;
  } else {
    const eq = negated ? '!=' : '==';
    test = values.length > 0 ? values.map((v) => `${field} ${eq} ${v}`).join(join) : `${field} ${eq} ""`;
  }
  return `if(${test}) {\n\treturn true;\n}\nreturn false;`;
}

function convertTransformers(mirthChannel: Record<string, unknown>): ChannelExportEntry['transformers'] {
  const transformers: ChannelExportEntry['transformers'] = [];

  const sourceTransformer = extractTransformerFromConnector(mirthChannel['sourceConnector'], null);
  if (sourceTransformer) transformers.push(sourceTransformer);

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
  if (!isPlainObject(connector)) return null;

  const transformer = connector['transformer'];
  if (!isPlainObject(transformer)) return null;

  const steps = transformerSteps(transformer);

  const inboundDataType = mirthDataType(getString(transformer, 'inboundDataType')) ?? 'HL7V2';
  const outboundDataType = mirthDataType(getString(transformer, 'outboundDataType')) ?? 'HL7V2';

  if (steps.length === 0 && inboundDataType === 'HL7V2' && outboundDataType === 'HL7V2') {
    return null;
  }

  return {
    connectorId: null,
    metaDataId,
    inboundDataType,
    outboundDataType,
    inboundProperties: withDelimitedOptions(extractDataTypeProperties(transformer, 'inboundProperties'), inboundDataType),
    outboundProperties: extractDataTypeProperties(transformer, 'outboundProperties'),
    inboundTemplate: getString(transformer, 'inboundTemplate'),
    outboundTemplate: getString(transformer, 'outboundTemplate'),
    steps,
  };
}

function extractDataTypeProperties(transformer: Record<string, unknown>, key: string): Record<string, unknown> {
  const node = transformer[key];
  if (!isPlainObject(node)) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith('@_')) {
      result[k] = v;
    }
  }
  return result;
}

/** Mirth's own serializationProperties stay as they are, for export back. */
function withDelimitedOptions(props: Record<string, unknown>, dataType: string): Record<string, unknown> {
  if (dataType !== 'DELIMITED') return props;
  const ser = props['serializationProperties'];
  const text = (key: string): string | undefined => {
    const value = getString(ser, key);
    // Mirth writes control characters in Delimited settings as `\n`, `\r`, `\t` and `\\`.
    return value === null ? undefined : unescapeControlChars(value);
  };
  const names = text('columnNames');
  const delimited = {
    ...(text('columnDelimiter') !== undefined ? { columnDelimiter: text('columnDelimiter') } : {}),
    ...(text('recordDelimiter') !== undefined ? { recordDelimiter: text('recordDelimiter') } : {}),
    ...(text('quoteToken') !== undefined ? { quote: text('quoteToken') } : {}),
    ...(text('quoteEscapeToken') !== undefined ? { quoteEscape: text('quoteEscapeToken') } : {}),
    escapeWithDoubleQuote: getBoolean(ser, 'escapeWithDoubleQuote', true),
    ignoreCR: getBoolean(ser, 'ignoreCR', true),
    columnNames: names ? names.split(',').map((n) => n.trim()).filter((n) => n !== '') : [],
  };
  return { ...props, delimited };
}

/** Mirth's XML view of a Delimited message: `msg['row']` or `msg.row`. */
const MIRTH_ROW_ACCESS = /\bmsg\s*(?:\[\s*['"]row['"]\s*\]|\.row\b)/;

function delimitedWarnings(entry: ChannelExportEntry): string[] {
  const channelName = entry.name;
  const transformer = entry.transformers.find((t) => (t.metaDataId ?? null) === null);
  if (transformer?.inboundDataType !== 'DELIMITED') return [];
  const warnings: string[] = [];
  if (channelScripts(entry).some((s) => MIRTH_ROW_ACCESS.test(s))) {
    warnings.push(`Channel "${channelName}": Delimited messages arrive as an array of rows keyed by column name; read msg[0].column, not msg['row']['column']`);
  }
  const widths = getString(transformer.inboundProperties['serializationProperties'], 'columnWidths');
  if (widths !== null && widths.trim() !== '') {
    warnings.push(`Channel "${channelName}": fixed-width columns are not supported; the message is split on the column delimiter instead`);
  }
  return warnings;
}

const CHANNEL_SCRIPTS = [
  ['deployScript', 'DEPLOY'],
  ['undeployScript', 'UNDEPLOY'],
  ['preprocessingScript', 'PREPROCESSOR'],
  ['postprocessingScript', 'POSTPROCESSOR'],
] as const;

/** Every script of the channel, its connectors' included. */
function channelScripts(entry: ChannelExportEntry): readonly string[] {
  return [
    ...entry.scripts.map((s) => s.script),
    ...entry.filters.flatMap((f) => f.rules.map((r) => r.script ?? '')),
    ...entry.transformers.flatMap((t) => t.steps.map((s) => s.script ?? '')),
    getString(entry.sourceConnectorProperties, 'script') ?? '',
    ...entry.destinations.flatMap((d) => [getString(d.properties, 'script') ?? '', d.responseTransformer ?? '']),
  ];
}

function convertScripts(mirthChannel: Record<string, unknown>): ChannelExportEntry['scripts'] {
  const scripts: ChannelExportEntry['scripts'] = [];
  for (const [key, scriptType] of CHANNEL_SCRIPTS) {
    const script = getString(mirthChannel, key);
    if (script && !isMirthDefaultScript(script)) scripts.push({ scriptType, script });
  }
  return scripts;
}

function convertMetadataColumns(mirthChannel: Record<string, unknown>): ChannelExportEntry['metadataColumns'] {
  const props = isPlainObject(mirthChannel['properties'])
    ? mirthChannel['properties'] as Record<string, unknown>
    : {};
  const columns = props['metaDataColumns'];
  if (!isPlainObject(columns)) return [];

  const inner = columns['metaDataColumn'];
  if (!inner) return [];

  const list = Array.isArray(inner) ? inner : [inner];
  return list.filter(isPlainObject).map((col) => ({
    name: getString(col, 'name') ?? '',
    dataType: getString(col, 'type') ?? 'STRING',
    mappingExpression: getString(col, 'mappingName'),
  }));
}

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
