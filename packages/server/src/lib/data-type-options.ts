import type { z } from 'zod/v4';
import type { DataTypeOptions } from '@galvanigraph/engine';
import { delimitedOptionsSchema, hl7OptionsSchema } from '@galvanigraph/core-models';
import { ServiceError } from './service-error.js';

function settings<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new ServiceError('INVALID_INPUT', `${label} settings are invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return parsed.data;
}

/**
 * The settings a data type reads from the source transformer's inbound
 * properties. Deploy and the script test run both read them here, so a test
 * run reads its sample as the deployed channel would (#474). Throws a
 * ServiceError on settings that do not validate.
 */
export function dataTypeOptionsFrom(dataType: string | undefined, properties: Readonly<Record<string, unknown>>): DataTypeOptions {
  switch (dataType) {
    case 'DELIMITED': return { delimited: settings(delimitedOptionsSchema, properties['delimited'], 'Delimited') };
    case 'HL7V2': return { hl7: settings(hl7OptionsSchema, properties['hl7'], 'HL7 v2') };
    default: return {};
  }
}
