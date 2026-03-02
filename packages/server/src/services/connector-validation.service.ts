// ===========================================
// Connector Validation Service
// ===========================================
// Validates connector properties at deploy time using Zod schemas.
// Each connector type has required fields that must be present and valid.
// Returns Result<void> — never throws.

import { z } from 'zod/v4';
import { stderr, type Result } from 'stderr-lib';
import { ServiceError } from '../lib/service-error.js';

// ----- Reusable Schemas -----

const portSchema = z.number().int().min(1).max(65535);
const nonEmptyString = z.string().min(1);

// ----- Source Connector Schemas -----

const tcpMllpSourceSchema = z.object({ port: portSchema }).passthrough();
const httpSourceSchema = z.object({ port: portSchema }).passthrough();
const fileSourceSchema = z.object({ directory: nonEmptyString }).passthrough();
const databaseSourceSchema = z.object({
  host: nonEmptyString,
  port: z.number(),
  database: nonEmptyString,
  selectQuery: nonEmptyString,
}).passthrough();
const javascriptSourceSchema = z.object({ script: nonEmptyString }).passthrough();
const channelSourceSchema = z.object({ channelId: nonEmptyString }).passthrough();
const dicomSourceSchema = z.object({ port: portSchema, storageDir: nonEmptyString }).passthrough();

// ----- Destination Connector Schemas -----

const tcpMllpDestSchema = z.object({ host: nonEmptyString, port: portSchema }).passthrough();
const httpDestSchema = z.object({ url: nonEmptyString }).passthrough();
const fileDestSchema = z.object({ directory: nonEmptyString }).passthrough();
const databaseDestSchema = z.object({
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

// ----- Schema Registries -----

const SOURCE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  TCP_MLLP: tcpMllpSourceSchema,
  HTTP: httpSourceSchema,
  FILE: fileSourceSchema,
  DATABASE: databaseSourceSchema,
  JAVASCRIPT: javascriptSourceSchema,
  CHANNEL: channelSourceSchema,
  DICOM: dicomSourceSchema,
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
};

// ----- Helpers -----

/** Format Zod issues into a human-readable semicolon-separated string. */
function formatIssues(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string {
  return issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

// ----- Public API -----

/** Validate connector properties for a given type and mode. Unknown types pass (forward compatibility). */
export function validateConnectorProperties(
  connectorType: string,
  mode: 'source' | 'destination',
  properties: Record<string, unknown>,
): Result<void> {
  const schemas = mode === 'source' ? SOURCE_SCHEMAS : DEST_SCHEMAS;
  const schema = schemas[connectorType];

  if (!schema) {
    return { ok: true, value: undefined as void, error: null };
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
