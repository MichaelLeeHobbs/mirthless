// ===========================================
// DATABASE Connector Property Schemas
// ===========================================
// Properties of the Database Reader (source) and Writer (destination), as a
// channel stores them. The server validates them at deploy and the connector
// registry parses them, so defaults live here only. A key not listed here
// fails validation.
//
// `port` has no default here: with none set, the registry uses the vendor's
// own (defaultDatabasePort). `tls` is a switch, not a certificate bag.

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  pollingIntervalSchema,
  withoutKeys,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';

/** Databases the connectors have a driver for. MariaDB uses `mysql`. */
export const DATABASE_VENDORS = ['postgresql', 'mysql'] as const;
export type DatabaseVendor = (typeof DATABASE_VENDORS)[number];

/** When the source runs its update query: never, after every row, or after each row the pipeline recorded. */
export const DATABASE_UPDATE_MODES = ['NEVER', 'ALWAYS', 'ON_SUCCESS'] as const;

/** How the source turns a row into a message. */
export const DATABASE_ROW_FORMATS = ['JSON'] as const;

/** The vendor's usual port; no vendor, or one with no driver, gets PostgreSQL's. */
export function defaultDatabasePort(vendor: string | undefined): number {
  return vendor === 'mysql' ? 3306 : 5432;
}

/** Text with something other than whitespace in it. */
const requiredText = z.string().trim().min(1);

/** A Mirth channel on another database (sqlserver, oracle) keeps its vendor and refuses here, saying which. */
const vendor = z.enum(DATABASE_VENDORS, {
  error: (issue) => `database "${String(issue.input)}" is not supported (PostgreSQL and MySQL are)`,
}).optional();

/** Where and how both directions connect. */
const connection = {
  vendor,
  host: requiredText,
  port: connectorPortSchema.optional(),
  database: requiredText,
  /** Empty: PostgreSQL connects as PGUSER or the process's OS user, MySQL with no user name. */
  username: z.string().default(''),
  password: z.string().default(''),
  /** Connect over TLS and verify the server certificate. */
  tls: z.boolean().default(false),
} as const;

/** The source's keys; the docs guard compares them with the connector reference. */
export const databaseSourceObjectSchema = z.strictObject({
  ...connection,
  selectQuery: requiredText,
  updateQuery: z.string().default(''),
  updateMode: z.enum(DATABASE_UPDATE_MODES).default('NEVER'),
  /** The receiver refuses to poll more often than every 100 ms. */
  pollingIntervalMs: pollingIntervalSchema(100, 5_000),
  rowFormat: z.enum(DATABASE_ROW_FORMATS).default('JSON'),
  ...sourceCommonProperties,
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const databaseDestinationObjectSchema = z.strictObject({
  ...connection,
  query: requiredText,
  useTransaction: z.boolean().default(false),
  returnGeneratedKeys: z.boolean().default(false),
  ...destinationCommonProperties,
});

/**
 * Keys the Mirth importer wrote from 2026-03-03 until 2026-11-12 and nothing
 * read (#227). Such a channel deployed once its host, database and query were
 * filled in, and the editor cannot remove a key, so they are dropped.
 */
const MIRTH_IMPORT_KEYS: ReadonlySet<string> = new Set(['url', 'driver']);

/** A source's props with the old importer keys dropped, and its `query` (the importer's SELECT) as `selectQuery` when that is empty. */
function withoutImportedSourceKeys(value: unknown): unknown {
  const props = withoutKeys(value, MIRTH_IMPORT_KEYS);
  if (typeof props !== 'object' || props === null || Array.isArray(props) || !('query' in props)) return props;
  const { query, ...rest } = props as Record<string, unknown>;
  const select = rest['selectQuery'];
  const selectEmpty = typeof select !== 'string' || select.trim() === '';
  return selectEmpty && typeof query === 'string' ? { ...rest, selectQuery: query } : rest;
}

/** The source schema, needing an update query whenever the update mode runs one. */
export const databaseSourcePropertiesSchema = z.preprocess(withoutImportedSourceKeys, databaseSourceObjectSchema.superRefine((props, ctx) => {
  if (props.updateMode !== 'NEVER' && props.updateQuery.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['updateQuery'], message: `required when updateMode is ${props.updateMode}` });
  }
}));
export type DatabaseSourceProperties = z.infer<typeof databaseSourceObjectSchema>;

export const databaseDestinationPropertiesSchema = z.preprocess((value) => withoutKeys(value, MIRTH_IMPORT_KEYS), databaseDestinationObjectSchema);
export type DatabaseDestinationProperties = z.infer<typeof databaseDestinationObjectSchema>;
