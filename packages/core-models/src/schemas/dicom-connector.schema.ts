// Defaults live here only (D-274). An unlisted key fails the deploy, except the Mirth keys the importer copies.

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  requiredTextSchema,
  trimmedTextSchema,
  wholeNumberSchema,
  MAX_TIMER_DELAY_MS,
  withoutKeys,
  destinationTemplate,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';

export const DICOM_DISPATCH_MODES = ['PER_FILE', 'PER_ASSOCIATION'] as const;
export const DICOM_POST_ACTIONS = ['DELETE', 'MOVE', 'NONE'] as const;

/** DICOM caps an application entity title at 16 characters. */
const aeTitle = z.string().max(16);

/** 0: dcmjs-dimse's own default (180 s connect, 60 s association). */
const dicomTimeout = wholeNumberSchema(0, MAX_TIMER_DELAY_MS);

/** The source's keys; the docs guard compares them with the connector reference. */
export const dicomSourceObjectSchema = z.strictObject({
  port: connectorPortSchema,
  storageDir: requiredTextSchema,
  aeTitle: aeTitle.default('GALVANIGRAPH'),
  connectionTimeoutMs: dicomTimeout.default(10_000),
  dispatchMode: z.enum(DICOM_DISPATCH_MODES).default('PER_FILE'),
  postAction: z.enum(DICOM_POST_ACTIONS).default('DELETE'),
  moveToDirectory: z.string().default(''),
  ...sourceCommonProperties,
});
export type DicomSourceProperties = z.infer<typeof dicomSourceObjectSchema>;

/** The destination's keys; the docs guard compares them with the connector reference. */
export const dicomDestinationObjectSchema = z.strictObject({
  host: trimmedTextSchema,
  port: connectorPortSchema,
  calledAETitle: aeTitle.default('PACS'),
  callingAETitle: aeTitle.default('GALVANIGRAPH'),
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
  // Saved by this app's editor until #154; the listener never used them.
  'minPoolSize', 'maxPoolSize',
]);

/** Mirth's DICOM Sender properties other than host, port and template (DICOMDispatcherProperties.java). */
const DESTINATION_LEGACY_KEYS: ReadonlySet<string> = new Set([
  ...MIRTH_COMMON, 'destinationConnectorProperties', 'acceptTo', 'connectTo', 'priority', 'passcode', 'rspTo', 'shutdownDelay',
  'stgcmt', 'ts1', 'uidnegrsp', 'username',
  // Saved by this app's editor until #154; the sender never read them.
  'mode', 'maxAssociations',
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

function dropDestinationLegacy(value: unknown, ctx: z.RefinementCtx): unknown {
  const props = withoutMirthKeys(value, DESTINATION_LEGACY_KEYS, ctx);
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return props;
  const { template, ...rest } = props as Record<string, unknown>;
  return typeof template === 'string' && destinationTemplate('DICOM', { template }) === undefined ? rest : props;
}

/** The source schema: a move-to directory for MOVE. */
export const dicomSourcePropertiesSchema = z.preprocess(
  (value, ctx) => withoutMirthKeys(value, SOURCE_LEGACY_KEYS, ctx),
  dicomSourceObjectSchema.superRefine((props, ctx) => {
    if (props.postAction === 'MOVE' && props.moveToDirectory.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['moveToDirectory'], message: 'required when postAction is MOVE' });
    }
  }),
);

export const dicomDestinationPropertiesSchema = z.preprocess(dropDestinationLegacy, dicomDestinationObjectSchema);
