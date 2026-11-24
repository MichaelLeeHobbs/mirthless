// Defaults live here only (D-274).
//
// Which `${name}` placeholders a file name template may use is checked by the
// dispatcher (packages/connectors/src/sftp/sftp-dispatcher.ts), which fills them.

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  requiredTextSchema,
  trimmedTextSchema,
  wholeNumberSchema,
  pollingIntervalSchema,
  charsetSchema,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';

export const SFTP_POST_ACTIONS = ['DELETE', 'MOVE', 'NONE'] as const;

const connection = {
  host: trimmedTextSchema,
  port: connectorPortSchema.default(22),
  username: requiredTextSchema,
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  remoteDirectory: requiredTextSchema,
  /** Check the server's host key against `hostKey`. */
  strictHostKey: z.boolean().default(true),
  hostKey: z.string().optional(),
} as const;

/** The source's keys; the docs guard compares them with the connector reference. */
export const sftpSourceObjectSchema = z.strictObject({
  ...connection,
  /** Glob, case-sensitive as Mirth's (D-304). */
  filePattern: requiredTextSchema.default('*'),
  /** Leave names starting with `.` alone, as a Mirth File Reader does by default. */
  ignoreDot: z.boolean().default(true),
  /** The receiver refuses to poll more often than every 100 ms. */
  pollingIntervalMs: pollingIntervalSchema(100, 5_000),
  afterProcessing: z.enum(SFTP_POST_ACTIONS).default('DELETE'),
  moveToDirectory: z.string().default(''),
  /** Milliseconds a file must be unchanged before it is read. */
  minFileAgeMs: wholeNumberSchema(0).default(1_000),
  charset: charsetSchema,
  ...sourceCommonProperties,
});
export type SftpSourceProperties = z.infer<typeof sftpSourceObjectSchema>;

/** The destination's keys; the docs guard compares them with the connector reference. */
export const sftpDestinationObjectSchema = z.strictObject({
  ...connection,
  fileNameTemplate: requiredTextSchema.default('${messageId}.dat'),
  appendMode: z.boolean().default(false),
  ...destinationCommonProperties,
});
export type SftpDestinationProperties = z.infer<typeof sftpDestinationObjectSchema>;

type SftpLogin = Pick<SftpSourceProperties, 'password' | 'privateKey' | 'strictHostKey' | 'hostKey'>;

/**
 * The connector refuses to connect without a password or a private key, and
 * with host key checking on it rejects every server until a host key is set.
 */
function checkLogin(props: SftpLogin, ctx: z.RefinementCtx): void {
  if (!props.password && !props.privateKey) {
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'SFTP needs a password or a privateKey' });
  }
  if (props.strictHostKey && !props.hostKey?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['hostKey'], message: 'host key checking is on, so the server host key is required' });
  }
}

export const sftpSourcePropertiesSchema = sftpSourceObjectSchema.superRefine((props, ctx) => {
  checkLogin(props, ctx);
  if (props.afterProcessing === 'MOVE' && props.moveToDirectory.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['moveToDirectory'], message: 'required when afterProcessing is MOVE' });
  }
});

export const sftpDestinationPropertiesSchema = sftpDestinationObjectSchema.superRefine(checkLogin);
