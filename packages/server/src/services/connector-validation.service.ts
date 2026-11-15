// ===========================================
// Connector Validation Service
// ===========================================
// Validates connector properties at deploy time using Zod schemas.
// Each connector type has required fields that must be present and valid.
// Returns Result<void> — never throws.

import { z } from 'zod/v4';
import { stderr, type Result } from 'stderr-lib';
import {
  kafkaSourcePropertiesSchema,
  kafkaDestinationPropertiesSchema,
  amqpSourcePropertiesSchema,
  amqpDestinationPropertiesSchema,
} from '@galvaniflow/core-models';
import { ServiceError } from '../lib/service-error.js';

// ----- Reusable Schemas -----

// A port may arrive as text ("6661"), e.g. from a configuration map reference;
// the connector factories accept that too. Nothing else is coerced (true is
// not port 1), and a reference left unresolved says so.
const portSchema = z.preprocess(
  (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v),
  z.number({
    error: (issue) => (typeof issue.input === 'string' && issue.input.includes('${')
      ? `configuration map reference ${issue.input} did not resolve: no configuration entry has that name`
      : 'must be a port number'),
  }).int().min(1).max(65535),
);
const nonEmptyString = z.string().min(1);

// ----- Source Connector Schemas -----

const tcpMllpSourceSchema = z.object({ port: portSchema }).passthrough();
const httpSourceSchema = z.object({ port: portSchema }).passthrough();
const fileSourceSchema = z.object({ directory: nonEmptyString }).passthrough();
/** Databases the connectors have a driver for; a Mirth channel on any other refuses to deploy. */
const databaseVendorSchema = z.enum(['postgresql', 'mysql'], {
  error: (issue) => `database "${String(issue.input)}" is not supported (PostgreSQL and MySQL are)`,
}).optional();
const databaseSourceSchema = z.object({
  vendor: databaseVendorSchema,
  host: nonEmptyString,
  port: z.number(),
  database: nonEmptyString,
  selectQuery: nonEmptyString,
}).passthrough();
const javascriptSourceSchema = z.object({ script: nonEmptyString }).passthrough();
const channelSourceSchema = z.object({ channelId: nonEmptyString }).passthrough();
const dicomSourceSchema = z.object({ port: portSchema, storageDir: nonEmptyString }).passthrough();
const emailSourceSchema = z.object({ host: nonEmptyString, port: portSchema, username: nonEmptyString, password: nonEmptyString }).passthrough();

/**
 * SFTP connection, as the registry reads it for both directions. The port
 * defaults to 22. The connector refuses to connect without a password or a
 * private key, and with host key checking on (the default) it rejects every
 * server until a host key is entered, so both fail here instead of at runtime.
 */
const sftpConnectionSchema = z.object({
  host: nonEmptyString,
  port: portSchema.optional(),
  username: nonEmptyString,
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  remoteDirectory: nonEmptyString,
  strictHostKey: z.boolean().optional(),
  hostKey: z.string().optional(),
}).passthrough();

type SftpConnection = z.infer<typeof sftpConnectionSchema>;

function checkSftpCredentials(props: SftpConnection, ctx: z.RefinementCtx): void {
  if (!props.password && !props.privateKey) {
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'SFTP needs a password or a privateKey' });
  }
  if (props.strictHostKey !== false && !props.hostKey?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['hostKey'], message: 'host key checking is on, so the server host key is required' });
  }
}

const sftpSourceSchema = sftpConnectionSchema.extend({
  afterProcessing: z.enum(['DELETE', 'MOVE', 'NONE']).optional(),
  moveToDirectory: z.string().optional(),
}).superRefine((props, ctx) => {
  checkSftpCredentials(props, ctx);
  if (props.afterProcessing === 'MOVE' && !props.moveToDirectory) {
    ctx.addIssue({ code: 'custom', path: ['moveToDirectory'], message: 'required when afterProcessing is MOVE' });
  }
});

// ----- Destination Connector Schemas -----

const tcpMllpDestSchema = z.object({ host: nonEmptyString, port: portSchema }).passthrough();
const httpDestSchema = z.object({ url: nonEmptyString }).passthrough();
const fileDestSchema = z.object({ directory: nonEmptyString }).passthrough();
const databaseDestSchema = z.object({
  vendor: databaseVendorSchema,
  host: nonEmptyString,
  port: z.number(),
  database: nonEmptyString,
  query: nonEmptyString,
}).passthrough();
const javascriptDestSchema = z.object({ script: nonEmptyString }).passthrough();
const smtpDestSchema = z.object({ host: nonEmptyString, port: z.number(), to: nonEmptyString }).passthrough();
const channelDestSchema = z.object({ targetChannelId: nonEmptyString }).passthrough();
const fhirDestSchema = z.object({ baseUrl: nonEmptyString }).passthrough();
const dicomDestSchema = z.object({ host: nonEmptyString, port: portSchema }).passthrough();
const sftpDestSchema = sftpConnectionSchema.superRefine(checkSftpCredentials);

// ----- Schema Registries -----

const SOURCE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  TCP_MLLP: tcpMllpSourceSchema,
  HTTP: httpSourceSchema,
  FILE: fileSourceSchema,
  DATABASE: databaseSourceSchema,
  JAVASCRIPT: javascriptSourceSchema,
  CHANNEL: channelSourceSchema,
  DICOM: dicomSourceSchema,
  EMAIL: emailSourceSchema,
  SFTP: sftpSourceSchema,
  KAFKA: kafkaSourcePropertiesSchema,
  AMQP: amqpSourcePropertiesSchema,
};

const DEST_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  TCP_MLLP: tcpMllpDestSchema,
  HTTP: httpDestSchema,
  FILE: fileDestSchema,
  DATABASE: databaseDestSchema,
  JAVASCRIPT: javascriptDestSchema,
  SMTP: smtpDestSchema,
  CHANNEL: channelDestSchema,
  FHIR: fhirDestSchema,
  DICOM: dicomDestSchema,
  SFTP: sftpDestSchema,
  KAFKA: kafkaDestinationPropertiesSchema,
  AMQP: amqpDestinationPropertiesSchema,
};

// ----- Helpers -----

/** Format Zod issues into a human-readable semicolon-separated string. */
function formatIssues(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string {
  return issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

// ----- Public API -----

/**
 * Validate connector properties for a given type and mode. A type with no
 * schema in that mode fails: the registry could not build it either, and a new
 * connector type must not skip validation silently.
 */
export function validateConnectorProperties(
  connectorType: string,
  mode: 'source' | 'destination',
  properties: Record<string, unknown>,
): Result<void> {
  const schemas = mode === 'source' ? SOURCE_SCHEMAS : DEST_SCHEMAS;
  const schema = Object.hasOwn(schemas, connectorType) ? schemas[connectorType] : undefined;

  if (!schema) {
    return {
      ok: false,
      value: null,
      error: stderr(new ServiceError('INVALID_INPUT', `Unknown ${mode} connector type: ${connectorType}`)),
    };
  }

  const parsed = schema.safeParse(properties);
  if (!parsed.success) {
    const detail = formatIssues(parsed.error.issues);
    return {
      ok: false,
      value: null,
      error: stderr(new ServiceError(
        'INVALID_INPUT',
        `Invalid ${mode} connector properties for ${connectorType}: ${detail}`,
      )),
    };
  }

  return { ok: true, value: undefined as void, error: null };
}
