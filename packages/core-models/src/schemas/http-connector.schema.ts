// Defaults live here only (D-274). An unlisted key fails the deploy, except the
// keys this app's own editor used to save, which are dropped or mapped.
//
// `tls` holds certificate-store IDs. At deploy the server swaps them for PEM
// (packages/server/src/services/connector-tls-resolver.ts), so the registry
// parses with `tls` set aside and reads the PEM itself.

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  wholeNumberSchema,
  optionalTlsSchema,
  withoutKeys,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';
import { clientTlsRefSchema } from './queue-connector.schema.js';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** HTTPS takes its certificates from the store; with no scheme the destination goes by the URL. */
export const HTTP_SCHEMES = ['HTTP', 'HTTPS'] as const;
export type HttpScheme = (typeof HTTP_SCHEMES)[number];

/** A larger request body gets 413. */
export const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024;

export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    const name = colon > 0 ? line.slice(0, colon).trim() : '';
    if (name.length > 0) headers[name] = line.slice(colon + 1).trim();
  }
  return headers;
}

const method = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.enum(HTTP_METHODS),
).default('POST');

/** Node refuses to write a status outside 100-999. */
const statusCode = wholeNumberSchema(100, 599);

/** Values may use `${name}`. */
const textMap = z.record(z.string(), z.string());

/** Old HTTP and FHIR forms saved headers as `Name: value` lines, read the way the editor shows them. */
export const headerMapSchema = z.preprocess((value) => (typeof value === 'string' ? parseHeaderLines(value) : value), textMap);

/** The source's keys; the docs guard compares them with the connector reference. */
export const httpSourceObjectSchema = z.strictObject({
  host: z.string().default('0.0.0.0'),
  port: connectorPortSchema,
  /** A request path always starts with `/`, so a path without one would never match. */
  path: z.string().startsWith('/', { error: 'must start with /' }).default('/'),
  /** Also accept any path below `path`; off when absent. The editor has no control for it. */
  matchSubpaths: z.boolean().optional(),
  method,
  responseContentType: z.string().default('text/plain'),
  responseStatusCode: statusCode.default(200),
  errorStatusCode: statusCode.default(500),
  maxBodyBytes: wholeNumberSchema(1).default(DEFAULT_MAX_BODY_BYTES),
  /** Every credential is required: a missing one would let a request with an empty one in (#207). */
  auth: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('BASIC'), username: z.string().min(1), password: z.string().min(1) }),
    z.strictObject({ type: z.literal('TOKEN'), token: z.string().min(1) }),
  ]).optional(),
  scheme: z.enum(HTTP_SCHEMES).optional(),
  /** Certificate-store IDs; HTTPS needs `serverCertId` (checked when the server resolves it). */
  tls: optionalTlsSchema({
    serverCertId: z.string().optional(),
    caCertId: z.string().optional(),
    requireClientCert: z.boolean().optional(),
  }),
  ...sourceCommonProperties,
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const httpDestinationObjectSchema = z.strictObject({
  url: z.string().trim().min(1),
  method,
  headers: headerMapSchema.default({}),
  parameters: textMap.optional(),
  basicAuth: z.strictObject({ username: z.string(), password: z.string() }).optional(),
  contentType: z.string().default('text/plain'),
  /** Milliseconds; 0 would abort every send at once. */
  responseTimeout: wholeNumberSchema(1).default(30_000),
  scheme: z.enum(HTTP_SCHEMES).optional(),
  /** Certificate-store IDs: a CA to trust and a client certificate for mutual TLS. */
  tls: optionalTlsSchema(clientTlsRefSchema.shape),
  ...destinationCommonProperties,
});

/** Source keys the editor saved from 2026-02 (58ab3ae) to 2026-07 (349a666). No connector read them. */
const SOURCE_LEGACY_KEYS: ReadonlySet<string> = new Set(['contextPath', 'methods', 'charset']);

/** Destination key the editor saved from 2026-03 (ea01d81) to 2026-07 (349a666). No connector read it. */
const DESTINATION_LEGACY_KEYS: ReadonlySet<string> = new Set(['charset']);

/** Inline-PEM fields of `tls` the destination editor saved on 2026-07-14 (85a4575 to 6437e13), empty unless pasted into. */
const LEGACY_PEM_KEYS = ['ca', 'cert', 'key'] as const;

/** A filled inline-PEM field is kept, so it still fails. */
function dropDestinationLegacy(value: unknown): unknown {
  const props = withoutKeys(value, DESTINATION_LEGACY_KEYS);
  if (typeof props !== 'object' || props === null || !('tls' in props)) return props;
  const tls: unknown = props.tls;
  if (typeof tls !== 'object' || tls === null || Array.isArray(tls)) return props;
  const empty = new Set(LEGACY_PEM_KEYS.filter((key) => key in tls && ((tls as Record<string, unknown>)[key] ?? '') === ''));
  return { ...props, tls: withoutKeys(tls, empty) };
}

export const httpSourcePropertiesSchema = z.preprocess((value) => withoutKeys(value, SOURCE_LEGACY_KEYS), httpSourceObjectSchema);
export type HttpSourceProperties = z.infer<typeof httpSourceObjectSchema>;

export const httpDestinationPropertiesSchema = z.preprocess(dropDestinationLegacy, httpDestinationObjectSchema);
export type HttpDestinationProperties = z.infer<typeof httpDestinationObjectSchema>;
