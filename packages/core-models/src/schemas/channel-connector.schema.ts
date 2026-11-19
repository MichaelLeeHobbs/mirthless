// Defaults live here only (D-274). An unlisted key fails the deploy, except the keys the Mirth importer used to copy.
// Deploy sets the source's `channelId` to the channel's own id before it validates (deployment.service.ts).

import { z } from 'zod/v4';
import {
  requiredTextSchema,
  withoutKeys,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';

/** The source's keys; the docs guard compares them with the connector reference. */
export const channelSourceObjectSchema = z.strictObject({
  channelId: requiredTextSchema,
  ...sourceCommonProperties,
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const channelDestinationObjectSchema = z.strictObject({
  /** The target channel's id, or a `${name}` filled per message. */
  targetChannelId: requiredTextSchema,
  waitForResponse: z.boolean().default(false),
  ...destinationCommonProperties,
});

/**
 * Mirth's Channel Reader and Writer properties, which the importer copied
 * from 2026-03-03 to 2026-11-12 and nothing read (`responseConnectorProperties`
 * and `queueConnectorProperties` are a Mirth 3.0 export's names).
 */
const SOURCE_LEGACY_KEYS: ReadonlySet<string> = new Set(['pluginProperties', 'sourceConnectorProperties', 'responseConnectorProperties']);
const DESTINATION_LEGACY_KEYS: ReadonlySet<string> = new Set([
  'pluginProperties', 'destinationConnectorProperties', 'queueConnectorProperties', 'channelId', 'channelTemplate', 'mapVariables',
]);

export const channelSourcePropertiesSchema = z.preprocess((value) => withoutKeys(value, SOURCE_LEGACY_KEYS), channelSourceObjectSchema);
export type ChannelSourceProperties = z.infer<typeof channelSourceObjectSchema>;

export const channelDestinationPropertiesSchema = z.preprocess((value) => withoutKeys(value, DESTINATION_LEGACY_KEYS), channelDestinationObjectSchema);
export type ChannelDestinationProperties = z.infer<typeof channelDestinationObjectSchema>;
