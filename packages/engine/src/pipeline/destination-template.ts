// Filled once, before the outbound content is stored, so a queued retry sends the same text.

import { fillPlaceholders, hasPlaceholderText, recordLookup } from '@galvanigraph/core-util';

export interface TemplateMessage {
  readonly encoded: string;
  readonly raw: string;
  readonly messageId: number;
}

/** For a name in several maps, the first map's value wins. */
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
 * Built-ins first, then the maps in the order given (own keys only). A reference
 * nothing defines is left as written, so a mistake shows in the sent content
 * rather than silently becoming an empty string.
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
