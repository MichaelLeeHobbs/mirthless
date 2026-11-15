// ===========================================
// Error Message
// ===========================================

/**
 * Human-readable text for an unknown thrown value: the Error's message or the
 * string itself when non-empty, otherwise `fallback`. Never returns a blank,
 * so a failure is always shown with words.
 *
 * @param error - Any thrown or rejected value.
 * @param fallback - Text to show when the value carries no usable message.
 * @returns The message to display.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return fallback;
}
