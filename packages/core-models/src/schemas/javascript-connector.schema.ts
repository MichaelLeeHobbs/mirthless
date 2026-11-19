// Defaults live here only (D-274).
//
// The engine compiles `script` at deploy (packages/server/src/engine.ts), and
// the deploy type check reads `scriptLanguage` (D-296).

import { z } from 'zod/v4';
import {
  pollingIntervalSchema,
  requiredTextSchema,
  withoutKeys,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';
import { scriptLanguageSchema } from './script-language.schema.js';

/** Missing means JavaScript (D-296). */
const scriptLanguage = scriptLanguageSchema.optional();

/** The source's keys; the docs guard compares them with the connector reference. */
export const javascriptSourceObjectSchema = z.strictObject({
  /** Runs on every poll; each string it returns is one message. */
  script: requiredTextSchema,
  scriptLanguage,
  /** The receiver refuses to poll more often than every 100 ms. */
  pollingIntervalMs: pollingIntervalSchema(100, 5_000),
  ...sourceCommonProperties,
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const javascriptDestinationObjectSchema = z.strictObject({
  /** Runs once per message; its return value is the response. */
  script: requiredTextSchema,
  scriptLanguage,
  ...destinationCommonProperties,
});

/**
 * Mirth's own property groups, which the importer copied into a JavaScript
 * Reader or Writer until 2026-11-13 and nothing read. A Mirth 3.0.x export
 * names the response and queue groups `responseConnectorProperties` and
 * `queueConnectorProperties` (3.1 renamed them).
 */
const SOURCE_LEGACY_KEYS: ReadonlySet<string> = new Set([
  'pluginProperties', 'pollConnectorProperties', 'sourceConnectorProperties', 'responseConnectorProperties',
]);
const DESTINATION_LEGACY_KEYS: ReadonlySet<string> = new Set(['pluginProperties', 'destinationConnectorProperties', 'queueConnectorProperties']);

export const javascriptSourcePropertiesSchema = z.preprocess((value) => withoutKeys(value, SOURCE_LEGACY_KEYS), javascriptSourceObjectSchema);
export type JavaScriptSourceProperties = z.infer<typeof javascriptSourceObjectSchema>;

export const javascriptDestinationPropertiesSchema = z.preprocess((value) => withoutKeys(value, DESTINATION_LEGACY_KEYS), javascriptDestinationObjectSchema);
export type JavaScriptDestinationProperties = z.infer<typeof javascriptDestinationObjectSchema>;
