// Defaults live here only (D-274).

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  requiredTextSchema,
  pollingIntervalSchema,
  sourceCommonProperties,
} from './connector-property-fields.js';

/** Protocols the form offers; the receiver reads IMAP only. */
export const EMAIL_PROTOCOLS = ['IMAP', 'POP3'] as const;
export const EMAIL_POST_ACTIONS = ['DELETE', 'MARK_READ', 'MOVE'] as const;

/** The source's keys; the docs guard compares them with the connector reference. */
export const emailSourceObjectSchema = z.strictObject({
  host: requiredTextSchema,
  port: connectorPortSchema.default(993),
  /** Implicit TLS. */
  secure: z.boolean().default(true),
  username: requiredTextSchema,
  password: requiredTextSchema,
  protocol: z.enum(EMAIL_PROTOCOLS).default('IMAP'),
  folder: requiredTextSchema.default('INBOX'),
  /** The receiver refuses to poll more often than every second. */
  pollingIntervalMs: pollingIntervalSchema(1_000, 60_000),
  postAction: z.enum(EMAIL_POST_ACTIONS).default('MARK_READ'),
  moveToFolder: z.string().default(''),
  /** Only mail whose subject contains this text is read. */
  subjectFilter: z.string().default(''),
  includeAttachments: z.boolean().default(false),
  ...sourceCommonProperties,
});
export type EmailSourceProperties = z.infer<typeof emailSourceObjectSchema>;

export const emailSourcePropertiesSchema = emailSourceObjectSchema.superRefine((props, ctx) => {
  if (props.protocol !== 'IMAP') {
    ctx.addIssue({ code: 'custom', path: ['protocol'], message: 'only IMAP is supported' });
  }
  if (props.postAction === 'MOVE' && props.moveToFolder.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['moveToFolder'], message: 'required when postAction is MOVE' });
  }
});
