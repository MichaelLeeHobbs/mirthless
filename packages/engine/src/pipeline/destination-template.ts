// ===========================================
// Destination template
// ===========================================
// What a destination sends can be a template instead of the transformed
// message: `${oru}` sends a value a transformer put in the channel map, and
// `${message.encodedData}` the message itself. The template is filled once,
// before the outbound content is stored, so a queued retry sends the same text.

/** Values a template can name besides the maps. */
export interface TemplateMessage {
  readonly encoded: string;
  readonly raw: string;
  readonly messageId: number;
}

const REFERENCE = /\$\{([^}]+)\}/g;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Fill `${...}` references: `message.encodedData` (also `message.transformedData`),
 * `message.rawData` and `messageId`, then variables from the maps in the order
 * given. A reference nothing defines is left as written, so a mistake shows in
 * the sent content rather than silently becoming an empty string.
 */
export function renderDestinationTemplate(
  template: string,
  message: TemplateMessage,
  maps: readonly Readonly<Record<string, unknown>>[],
): string {
  return template.replace(REFERENCE, (whole, rawKey: string) => {
    const key = rawKey.trim();
    if (key === 'message.encodedData' || key === 'message.transformedData') return message.encoded;
    if (key === 'message.rawData') return message.raw;
    if (key === 'messageId') return String(message.messageId);
    for (const map of maps) {
      const value = map[key];
      if (value !== undefined && value !== null) return asText(value);
    }
    return whole;
  });
}
