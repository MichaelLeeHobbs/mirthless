// ===========================================
// JAVASCRIPT Connector Property Schemas
// ===========================================
// Properties of the JavaScript Reader (source) and Writer (destination), as a
// channel stores them. The server validates them at deploy and the connector
// registry parses them, so defaults live here only. A key not listed here
// fails validation.
//
// The engine compiles `script` at deploy (packages/server/src/engine.ts), and
// the deploy type check reads `scriptLanguage` (D-296).

import { z } from 'zod/v4';
import {
  wholeNumberSchema,
  withoutKeys,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';
import { scriptLanguageSchema } from './script-language.schema.js';

/** Text with something other than whitespace in it, kept as given. */
const requiredScript = z.string().refine((value) => value.trim() !== '', { message: 'required' });

/** Missing means JavaScript (D-296); the editor saves one of the two languages. */
const scriptLanguage = scriptLanguageSchema.optional();

/** The source's keys; the docs guard compares them with the connector reference. */
export const javascriptSourceObjectSchema = z.strictObject({
  /** Runs on every poll; each string it returns is one message. */
  script: requiredScript,
  scriptLanguage,
  /** The receiver refuses to poll more often than every 100 ms. */
  pollingIntervalMs: wholeNumberSchema(100).default(5_000),
  ...sourceCommonProperties,
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const javascriptDestinationObjectSchema = z.strictObject({
  /** Runs once per message; its return value is the response. */
  script: requiredScript,
  scriptLanguage,
  ...destinationCommonProperties,
});

/**
 * Mirth's own property groups, which the importer copied into a JavaScript
 * Reader or Writer until 2026-11-13 and nothing read.
 */
const SOURCE_LEGACY_KEYS: ReadonlySet<string> = new Set(['pluginProperties', 'pollConnectorProperties', 'sourceConnectorProperties']);
const DESTINATION_LEGACY_KEYS: ReadonlySet<string> = new Set(['pluginProperties', 'destinationConnectorProperties']);

export const javascriptSourcePropertiesSchema = z.preprocess((value) => withoutKeys(value, SOURCE_LEGACY_KEYS), javascriptSourceObjectSchema);
export type JavaScriptSourceProperties = z.infer<typeof javascriptSourceObjectSchema>;

export const javascriptDestinationPropertiesSchema = z.preprocess((value) => withoutKeys(value, DESTINATION_LEGACY_KEYS), javascriptDestinationObjectSchema);
export type JavaScriptDestinationProperties = z.infer<typeof javascriptDestinationObjectSchema>;
