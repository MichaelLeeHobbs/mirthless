// ===========================================
// DICOM Connector Property Schemas
// ===========================================
// Properties of the DICOM Listener (source) and Sender (destination), as a
// channel stores them. The server validates them at deploy and the connector
// registry parses them, so defaults live here only. A key not listed here
// fails validation, except the Mirth keys the importer copies.

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  requiredTextSchema,
  wholeNumberSchema,
  MAX_TIMER_DELAY_MS,
  withoutKeys,
  destinationTemplate,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';

export const DICOM_DISPATCH_MODES = ['PER_FILE', 'PER_ASSOCIATION'] as const;
export const DICOM_POST_ACTIONS = ['DELETE', 'MOVE', 'NONE'] as const;
export const DICOM_SEND_MODES = ['single', 'multiple'] as const;

/** A DICOM application entity title: at most 16 characters. */
const aeTitle = z.string().max(16);

/** Milliseconds for a DICOM association; 0 means dcmjs-dimse's own default (180 s connect, 60 s association). */
const dicomTimeout = wholeNumberSchema(0, MAX_TIMER_DELAY_MS);

/** The source's keys; the docs guard compares them with the connector reference. */
export const dicomSourceObjectSchema = z.strictObject({
  port: connectorPortSchema,
  /** Where received files are written before they are dispatched. */
  storageDir: requiredTextSchema,
  aeTitle: aeTitle.default('GALVANIFLOW'),
  minPoolSize: wholeNumberSchema(1).default(2),
  maxPoolSize: wholeNumberSchema(1).default(10),
  connectionTimeoutMs: dicomTimeout.default(10_000),
  dispatchMode: z.enum(DICOM_DISPATCH_MODES).default('PER_FILE'),
  postAction: z.enum(DICOM_POST_ACTIONS).default('DELETE'),
  moveToDirectory: z.string().default(''),
  ...sourceCommonProperties,
});
export type DicomSourceProperties = z.infer<typeof dicomSourceObjectSchema>;

/** The destination's keys; the docs guard compares them with the connector reference. */
export const dicomDestinationObjectSchema = z.strictObject({
  host: requiredTextSchema,
  port: connectorPortSchema,
  calledAETitle: aeTitle.default('PACS'),
  callingAETitle: aeTitle.default('GALVANIFLOW'),
  mode: z.enum(DICOM_SEND_MODES).default('multiple'),
  maxAssociations: wholeNumberSchema(0).default(4),
  maxRetries: wholeNumberSchema(0).default(3),
  retryDelayMs: dicomTimeout.default(1_000),
  timeoutMs: dicomTimeout.default(30_000),
  ...destinationCommonProperties,
});
export type DicomDestinationProperties = z.infer<typeof dicomDestinationObjectSchema>;

/** Keys of Mirth's DICOM connectors both directions share, plus 3.0 export names. */
const MIRTH_COMMON = [
  'pluginProperties', 'applicationEntity', 'localHost', 'localPort', 'localApplicationEntity', 'soCloseDelay', 'releaseTo', 'reaper',
  'pdv1', 'sndpdulen', 'rcvpdulen', 'async', 'bufSize', 'sorcvbuf', 'sosndbuf', 'tcpDelay', 'keyPW', 'keyStore', 'keyStorePW',
  'noClientAuth', 'nossl2', 'trustStore', 'trustStorePW', 'responseConnectorProperties', 'queueConnectorProperties',
];

/**
 * Mirth's DICOM Listener properties, which the importer copied before it
 * mapped DICOM (#171) and nothing reads (DICOMReceiverProperties.java).
 */
const SOURCE_LEGACY_KEYS: ReadonlySet<string> = new Set([
  ...MIRTH_COMMON, 'listenerConnectorProperties', 'sourceConnectorProperties', 'requestTo', 'idleTo', 'rspDelay', 'bigEndian',
  'defts', 'dest', 'nativeData',
]);

/** Mirth's DICOM Sender properties other than host, port and template (DICOMDispatcherProperties.java). */
const DESTINATION_LEGACY_KEYS: ReadonlySet<string> = new Set([
  ...MIRTH_COMMON, 'destinationConnectorProperties', 'acceptTo', 'connectTo', 'priority', 'passcode', 'rspTo', 'shutdownDelay',
  'stgcmt', 'ts1', 'uidnegrsp', 'username',
]);

/**
 * Mirth's DICOM `tls` setting: `notls` unless TLS is on. This connector has
 * no TLS, so a channel set for TLS in Mirth is refused rather than run in
 * plaintext; `notls` (or nothing) is dropped like the other Mirth keys.
 */
function withoutMirthKeys(value: unknown, keys: ReadonlySet<string>, ctx: z.RefinementCtx): unknown {
  const props = withoutKeys(value, keys);
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return props;
  const { tls, ...rest } = props as Record<string, unknown>;
  if (tls !== undefined && tls !== 'notls' && tls !== '') {
    ctx.addIssue({ code: 'custom', path: ['tls'], message: `Mirth's DICOM TLS setting "${String(tls)}" is not supported: this connector has no TLS and would send in plaintext` });
  }
  return rest;
}

/** Destination props without the Mirth keys, and without a template that means the message itself. */
function dropDestinationLegacy(value: unknown, ctx: z.RefinementCtx): unknown {
  const props = withoutMirthKeys(value, DESTINATION_LEGACY_KEYS, ctx);
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return props;
  const { template, ...rest } = props as Record<string, unknown>;
  return typeof template === 'string' && destinationTemplate('DICOM', { template }) === undefined ? rest : props;
}

/** The source schema: the pool's maximum at least its minimum, and a move-to directory for MOVE. */
export const dicomSourcePropertiesSchema = z.preprocess(
  (value, ctx) => withoutMirthKeys(value, SOURCE_LEGACY_KEYS, ctx),
  dicomSourceObjectSchema.superRefine((props, ctx) => {
    if (props.maxPoolSize < props.minPoolSize) {
      ctx.addIssue({ code: 'custom', path: ['maxPoolSize'], message: 'must be at least minPoolSize' });
    }
    if (props.postAction === 'MOVE' && props.moveToDirectory.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['moveToDirectory'], message: 'required when postAction is MOVE' });
    }
  }),
);

export const dicomDestinationPropertiesSchema = z.preprocess(dropDestinationLegacy, dicomDestinationObjectSchema);
