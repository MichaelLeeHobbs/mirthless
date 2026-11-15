// ===========================================
// Destination template
// ===========================================
// What a destination sends can be a template instead of the transformed
// message: `${oru}` sends a value a transformer put in the channel map, and
// `${message.encodedData}` the message itself. The template is filled once,
// before the outbound content is stored, so a queued retry sends the same text.

import { fillPlaceholders, hasPlaceholderText, recordLookup } from '@galvaniflow/core-util';

/** Values a template can name besides the maps. */
export interface TemplateMessage {
  readonly encoded: string;
  readonly raw: string;
  readonly messageId: number;
}

/** One record of the maps' variables; for a name in several maps the first map's value wins. */
export function mergeVariables(maps: readonly Readonly<Record<string, unknown>>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (let i = maps.length - 1; i >= 0; i--) {
    for (const [key, value] of Object.entries(maps[i] ?? {})) {
      if (value !== undefined && value !== null) merged[key] = value;
    }
  }
  return merged;
}

/**
 * Fill `${...}` references by the shared rule in {@link fillPlaceholders}:
 * `message.encodedData` (also `message.transformedData`), `message.rawData`
 * and `messageId`, then variables from the maps in the order given (own keys
 * only). A reference nothing defines is left as written, so a mistake shows in
 * the sent content rather than silently becoming an empty string.
 */
export function renderDestinationTemplate(
  template: string,
  message: TemplateMessage,
  maps: readonly Readonly<Record<string, unknown>>[],
): string {
  const builtIns = recordLookup({
    'message.encodedData': message.encoded,
    'message.transformedData': message.encoded,
    'message.rawData': message.raw,
    messageId: String(message.messageId),
  });
  const variables = maps.map(recordLookup);
  return fillPlaceholders(template, (name) => {
    for (const lookup of [builtIns, ...variables]) {
      const value = lookup(name);
      // A function or symbol cannot be written, so a later map's value is used instead.
      if (hasPlaceholderText(value)) return value;
    }
    return undefined;
  });
}
