// ===========================================
// SMTP Connector Property Schemas
// ===========================================
// Properties of the SMTP destination, as a channel stores them. The server
// validates them at deploy and the connector registry parses them, so
// defaults live here only. A key not listed here fails validation.

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  requiredTextSchema,
  destinationCommonProperties,
} from './connector-property-fields.js';

export const SMTP_CONTENT_TYPES = ['text/plain', 'text/html'] as const;

/** One configured attachment; `filename` and `content` may use `${...}` variables. */
const attachmentSchema = z.strictObject({
  filename: z.string(),
  mimeType: z.string().optional(),
  content: z.string(),
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const smtpDestinationObjectSchema = z.strictObject({
  host: requiredTextSchema,
  port: connectorPortSchema.default(587),
  /** Implicit TLS. */
  secure: z.boolean().default(false),
  /** Refuse to send unless the server offers STARTTLS. */
  requireTLS: z.boolean().default(false),
  /** With no user, the server is used as an anonymous relay. */
  authUser: z.string().optional(),
  authPass: z.string().optional(),
  from: requiredTextSchema,
  to: requiredTextSchema,
  cc: z.string().default(''),
  bcc: z.string().default(''),
  subject: z.string().default(''),
  bodyTemplate: z.string().default('${msg}'),
  contentType: z.enum(SMTP_CONTENT_TYPES).default('text/plain'),
  /** Also attach the message content as `message.txt`. */
  attachContent: z.boolean().default(false),
  attachments: z.array(attachmentSchema).default([]),
  ...destinationCommonProperties,
});

export const smtpDestinationPropertiesSchema = smtpDestinationObjectSchema;
export type SmtpDestinationProperties = z.infer<typeof smtpDestinationObjectSchema>;
