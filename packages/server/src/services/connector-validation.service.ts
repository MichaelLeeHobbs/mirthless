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
  tcpMllpSourcePropertiesSchema,
  tcpMllpDestinationPropertiesSchema,
  httpSourcePropertiesSchema,
  httpDestinationPropertiesSchema,
  databaseSourcePropertiesSchema,
  databaseDestinationPropertiesSchema,
  fileSourcePropertiesSchema,
  fileDestinationPropertiesSchema,
  javascriptSourcePropertiesSchema,
  javascriptDestinationPropertiesSchema,
  channelSourcePropertiesSchema,
  channelDestinationPropertiesSchema,
  fhirDestinationPropertiesSchema,
  smtpDestinationPropertiesSchema,
  dicomSourcePropertiesSchema,
  dicomDestinationPropertiesSchema,
  emailSourcePropertiesSchema,
  sftpSourcePropertiesSchema,
  sftpDestinationPropertiesSchema,
  formatPropertyIssues,
} from '@galvaniflow/core-models';
import { ServiceError } from '../lib/service-error.js';

// Every connector type's properties have one schema in core-models (#115).

// ----- Schema Registries -----

const SOURCE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  TCP_MLLP: tcpMllpSourcePropertiesSchema,
  HTTP: httpSourcePropertiesSchema,
  FILE: fileSourcePropertiesSchema,
  DATABASE: databaseSourcePropertiesSchema,
  JAVASCRIPT: javascriptSourcePropertiesSchema,
  CHANNEL: channelSourcePropertiesSchema,
  DICOM: dicomSourcePropertiesSchema,
  EMAIL: emailSourcePropertiesSchema,
  SFTP: sftpSourcePropertiesSchema,
  KAFKA: kafkaSourcePropertiesSchema,
  AMQP: amqpSourcePropertiesSchema,
};

const DEST_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  TCP_MLLP: tcpMllpDestinationPropertiesSchema,
  HTTP: httpDestinationPropertiesSchema,
  FILE: fileDestinationPropertiesSchema,
  DATABASE: databaseDestinationPropertiesSchema,
  JAVASCRIPT: javascriptDestinationPropertiesSchema,
  SMTP: smtpDestinationPropertiesSchema,
  CHANNEL: channelDestinationPropertiesSchema,
  FHIR: fhirDestinationPropertiesSchema,
  DICOM: dicomDestinationPropertiesSchema,
  SFTP: sftpDestinationPropertiesSchema,
  KAFKA: kafkaDestinationPropertiesSchema,
  AMQP: amqpDestinationPropertiesSchema,
};

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
    const detail = formatPropertyIssues(parsed.error.issues);
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
