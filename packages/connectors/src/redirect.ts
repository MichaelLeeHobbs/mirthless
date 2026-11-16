// ===========================================
// Redirect Answers
// ===========================================
// The HTTP and FHIR destinations never follow a redirect. fetch would re-send
// a POST as a GET without the body, and the page it lands on answers 200, so a
// message that went nowhere would be recorded as SENT. They report a 3xx as an
// error with this text instead.

/**
 * Error text for a redirect answer, naming the target when the server gave one.
 *
 * @param status - The 3xx status code.
 * @param location - The response's Location header, or null when absent.
 */
export function redirectMessage(status: number, location: string | null): string {
  const target = location ? ` to ${location}` : '';
  return `HTTP ${String(status)}: the server redirected${target}. Redirects are not followed; set the destination URL to the final address.`;
}
