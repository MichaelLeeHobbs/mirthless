// Mirth settings GalvaniGraph has no equivalent of (D-301): named in the preview, and holding the
// channel where running without them would lose or change data nobody chose to.

import { isPlainObject } from '@galvanigraph/core-util';
import { scriptElements } from './mirth-steps.js';
import { getBoolean, getNestedRecord, getString, stringList, toRecordList } from './mirth-xml.js';

/** Mirth's name for the channel's attachment handler, or null when it has none. */
function attachmentHandler(mirthChannel: Record<string, unknown>): string | null {
  const props = getNestedRecord(getNestedRecord(mirthChannel, 'properties') ?? {}, 'attachmentProperties') ?? {};
  const className = getString(props, 'className') ?? '';
  const type = getString(props, 'type') ?? className.slice(className.lastIndexOf('.') + 1);
  return type === '' || type === 'None' ? null : type;
}

export function attachmentWarnings(mirthChannel: Record<string, unknown>, channelName: string): string[] {
  const handler = attachmentHandler(mirthChannel);
  return handler === null ? []
    : [`Channel "${channelName}": its attachment handler (${handler}) is not carried; GalvaniGraph keeps attachments inside the message, where scripts see them and storage holds them`];
}

/** `destinations`: those Mirth sends to. */
export function attachmentHolds(mirthChannel: Record<string, unknown>, destinations: readonly Record<string, unknown>[]): string[] {
  const handler = attachmentHandler(mirthChannel);
  if (handler === null) return [];
  const holds: string[] = [];
  if (handler === 'JavaScript' || handler === 'Custom') holds.push(`its ${handler} attachment handler can change the message before it is processed, and does not run here`);
  for (const dest of destinations) {
    const props = getNestedRecord(getNestedRecord(dest, 'properties') ?? {}, 'destinationConnectorProperties') ?? {};
    if (!getBoolean(props, 'reattachAttachments', true)) {
      holds.push(`Mirth sends "${getString(dest, 'name') ?? ''}" the message without its attachments, and it would get them here`);
    }
  }
  return holds;
}

const MIRTH_ACK_DEFAULTS: Readonly<Record<string, string>> = {
  segmentDelimiter: '\\r',
  successfulACKCode: 'AA',
  successfulACKMessage: '',
  errorACKCode: 'AE',
  errorACKMessage: 'An Error Occurred Processing Message.',
  rejectedACKCode: 'AR',
  rejectedACKMessage: 'Message Rejected.',
  msh15ACKAccept: 'false',
  dateFormat: 'yyyyMMddHHmmss.SSS',
};

function hasEnabledRule(sourceConnector: Record<string, unknown>): boolean {
  const filter = getNestedRecord(sourceConnector, 'filter');
  return filter !== null && scriptElements(filter, 'rules', 'rule').some(({ node }) => getBoolean(node, 'enabled', true));
}

/** Mirth uses these settings only where it generates the answer itself. */
export function ackWarnings(sourceConnector: Record<string, unknown>, channelName: string): string[] {
  const transformer = getNestedRecord(sourceConnector, 'transformer') ?? {};
  const source = getNestedRecord(getNestedRecord(sourceConnector, 'properties') ?? {}, 'sourceConnectorProperties') ?? {};
  const respondFrom = getString(source, 'responseVariable') ?? '';
  if (getString(transformer, 'inboundDataType') !== 'HL7V2' || !respondFrom.startsWith('Auto-generate')) return [];
  const ack = getNestedRecord(getNestedRecord(transformer, 'inboundProperties') ?? {}, 'responseGenerationProperties') ?? {};
  const changed = Object.entries(MIRTH_ACK_DEFAULTS).flatMap(([key, usual]) => {
    const value = getString(ack, key) ?? usual;
    return value === usual ? [] : [`${key} "${value}"`];
  });
  const warnings = changed.length === 0 ? []
    : [`Channel "${channelName}": its acknowledgement settings are not carried (${changed.join(', ')}); GalvaniGraph answers AA or AE in its own form. Build another answer in a postprocessor`];
  const rejected = getString(ack, 'rejectedACKCode') ?? 'AR';
  if (respondFrom !== 'Auto-generate (Before processing)' && rejected !== 'AA' && hasEnabledRule(sourceConnector)) {
    warnings.push(`Channel "${channelName}": a filtered message is answered ${rejected} in Mirth and AA here`);
  }
  return warnings;
}

/** A Mirth attachment is sent as its text for these types, and for any other decoded from base64. */
function isTextAttachment(mimeType: string): boolean {
  return !mimeType.includes('/') || mimeType.startsWith('text/') || mimeType.toLowerCase() === 'application/xml';
}

interface SmtpAttachment {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string;
}

function smtpAttachments(propsNode: Record<string, unknown>): readonly SmtpAttachment[] {
  if (getBoolean(propsNode, 'isUseAttachmentsVariable', false)) return [];
  const list = propsNode['attachments'];
  if (!isPlainObject(list)) return [];
  return Object.values(list).flatMap(toRecordList).map((a) => {
    const mimeType = getString(a, 'mimeType') ?? '';
    return { filename: getString(a, 'name') ?? '', mimeType: mimeType.includes('/') ? mimeType : 'text/plain', content: getString(a, 'content') ?? '' };
  });
}

export function smtpTextAttachments(propsNode: Record<string, unknown>): readonly SmtpAttachment[] {
  return smtpAttachments(propsNode).filter((a) => isTextAttachment(a.mimeType));
}

/** The first string of each entry of a Mirth string map. */
function mapKeys(node: unknown): readonly string[] {
  return isPlainObject(node) ? toRecordList(node['entry']).map((entry) => stringList(entry)[0] ?? '') : [];
}

/** What an email would go out without. */
function smtpLosses(propsNode: Record<string, unknown>): readonly string[] {
  const headers = getBoolean(propsNode, 'isUseHeadersVariable', false)
    ? [`the headers in the map variable "${getString(propsNode, 'headersVariable') ?? ''}"`]
    : mapKeys(propsNode['headers']).map((name) => `the header ${name}`);
  const attachments = getBoolean(propsNode, 'isUseAttachmentsVariable', false)
    ? [`the attachments in the map variable "${getString(propsNode, 'attachmentsVariable') ?? ''}"`]
    : smtpAttachments(propsNode).filter((a) => !isTextAttachment(a.mimeType))
      .map((a) => `the attachment "${a.filename}" (${a.mimeType}, which Mirth decodes from base64)`);
  return [...headers, ...attachments];
}

export function smtpHold(propsNode: Record<string, unknown>, destination: string): string | null {
  const losses = smtpLosses(propsNode);
  return losses.length === 0 ? null : `the SMTP Sender "${destination}" would lose ${losses.join(', ')}`;
}

export function smtpWarnings(propsNode: Record<string, unknown>, destination: string, channelName: string): string[] {
  const prefix = `Channel "${channelName}": the SMTP Sender "${destination}"`;
  const warnings: string[] = [];
  const losses = smtpLosses(propsNode);
  if (losses.length > 0) warnings.push(`${prefix} sends ${losses.join(', ')} in Mirth, which GalvaniGraph's SMTP connector cannot send`);
  const charset = (getString(propsNode, 'charsetEncoding') ?? '').trim();
  if (!['', 'DEFAULT_ENCODING', 'UTF-8'].includes(charset.toUpperCase())) warnings.push(`${prefix} writes ${charset} in Mirth; GalvaniGraph's emails are UTF-8`);
  if ((getString(propsNode, 'replyTo') ?? '').trim() !== '') warnings.push(`${prefix} has a reply-to address, which GalvaniGraph's SMTP connector does not have; replies go to the From address`);
  return warnings;
}

const NOT_SECTIONS: ReadonlySet<string> = new Set(['date', 'channels', 'channel', 'codeTemplateLibraries', 'globalScripts']);

const SECTION_NAMES: Readonly<Record<string, string>> = {
  channelGroups: 'channel groups',
  channelTags: 'channel tags',
  serverSettings: 'server settings',
  updateSettings: 'update settings',
  pluginProperties: 'plugin settings',
  resourceProperties: 'resources',
  channelDependencies: 'channel dependencies',
  configurationMap: 'configuration map',
};

function hasContent(node: unknown): boolean {
  if (Array.isArray(node)) return node.length > 0;
  if (isPlainObject(node)) return Object.keys(node).some((key) => !key.startsWith('@_'));
  return node !== undefined && node !== null && node !== '';
}

function sectionsOf(node: Record<string, unknown>, except: ReadonlySet<string>): readonly string[] {
  return Object.entries(node)
    .filter(([key, value]) => !key.startsWith('@_') && !except.has(key) && hasContent(value))
    .map(([key]) => key);
}

/** Names only: the sections hold credentials. */
export function backupWarnings(serverConfiguration: Record<string, unknown>): string[] {
  const sections = sectionsOf(serverConfiguration, NOT_SECTIONS).map((key) => SECTION_NAMES[key] ?? key);
  const scripts = globalScripts(serverConfiguration).map(([name]) => name);
  return [
    ...(sections.length > 0 ? [`These sections of the backup are not imported; set up what you need of them here: ${sections.join(', ')}`] : []),
    ...(scripts.length > 0 ? [`The backup's global scripts are not imported (${scripts.join(', ')}); add them under Global Scripts, where they run for every channel of this server`] : []),
  ];
}

/** Those that do something, by name. */
function globalScripts(serverConfiguration: Record<string, unknown>): ReadonlyArray<readonly [string, string]> {
  const scripts = getNestedRecord(serverConfiguration, 'globalScripts') ?? {};
  return toRecordList(scripts['entry']).map(stringList)
    .map(([name, script]) => [name ?? '', script ?? ''] as const)
    .filter(([, script]) => !isMirthDefaultScript(script));
}

export function backupHolds(serverConfiguration: Record<string, unknown>): string[] {
  return globalScripts(serverConfiguration).some(([name]) => name === 'Preprocessor')
    ? ['the global preprocessor of the Mirth server is not imported, so its messages would be processed as received']
    : [];
}

/**
 * The scripts Mirth puts in every new channel and server, which do nothing: `return;`, and the
 * preprocessor's `return message;` (Mirth's name for the raw message, which GalvaniGraph does not have).
 */
export function isMirthDefaultScript(script: string): boolean {
  const code = script.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  return code === '' || code === 'return;' || code === 'return message;';
}

const CARRIED_EXPORT_DATA: ReadonlySet<string> = new Set(['metadata', 'codeTemplateLibraries']);

export function exportDataWarnings(mirthChannel: Record<string, unknown>, channelName: string): string[] {
  const sections = sectionsOf(getNestedRecord(mirthChannel, 'exportData') ?? {}, CARRIED_EXPORT_DATA);
  return sections.length === 0 ? [] : [`Channel "${channelName}": what its export says of ${sections.join(', ')} is not imported`];
}
