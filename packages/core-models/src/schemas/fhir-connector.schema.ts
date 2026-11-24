// Defaults live here only (D-274).

import { z } from 'zod/v4';
import {
  requiredTextSchema,
  trimmedTextSchema,
  wholeNumberSchema,
  MAX_TIMER_DELAY_MS,
  destinationCommonProperties,
} from './connector-property-fields.js';
import { headerMapSchema } from './http-connector.schema.js';

export const FHIR_METHODS = ['POST', 'PUT'] as const;
export const FHIR_AUTH_TYPES = ['NONE', 'BASIC', 'BEARER', 'API_KEY'] as const;
export const FHIR_FORMATS = ['json', 'xml'] as const;

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** The destination's keys; the docs guard compares them with the connector reference. */
export const fhirDestinationObjectSchema = z.strictObject({
  baseUrl: trimmedTextSchema.refine(isUrl, { message: 'must be an absolute URL' }),
  resourceType: requiredTextSchema.default('Patient'),
  method: z.enum(FHIR_METHODS).default('POST'),
  authType: z.enum(FHIR_AUTH_TYPES).default('NONE'),
  authUsername: z.string().optional(),
  authPassword: z.string().optional(),
  authToken: z.string().optional(),
  authHeaderName: z.string().optional(),
  authApiKey: z.string().optional(),
  format: z.enum(FHIR_FORMATS).default('json'),
  /** Milliseconds; 0 would fail every send at once. */
  timeout: wholeNumberSchema(1, MAX_TIMER_DELAY_MS).default(30_000),
  headers: headerMapSchema.default({}),
  ...destinationCommonProperties,
});
export type FhirDestinationProperties = z.infer<typeof fhirDestinationObjectSchema>;

const AUTH_CREDENTIALS: Readonly<Record<(typeof FHIR_AUTH_TYPES)[number], ReadonlyArray<keyof FhirDestinationProperties>>> = {
  NONE: [],
  BASIC: ['authUsername', 'authPassword'],
  BEARER: ['authToken'],
  API_KEY: ['authHeaderName', 'authApiKey'],
};

export const fhirDestinationPropertiesSchema = fhirDestinationObjectSchema.superRefine((props, ctx) => {
  for (const key of AUTH_CREDENTIALS[props.authType]) {
    const value = props[key];
    if (typeof value !== 'string' || value.trim() === '') {
      ctx.addIssue({ code: 'custom', path: [key], message: `required when authType is ${props.authType}` });
    }
  }
});
