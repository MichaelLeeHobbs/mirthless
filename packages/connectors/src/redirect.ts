// The HTTP and FHIR destinations never follow a redirect: fetch would re-send a
// POST as a GET without the body, and the page it lands on answers 200, so a
// message that went nowhere would be recorded as SENT.

export function redirectMessage(status: number, location: string | null): string {
  const target = location ? ` to ${location}` : '';
  return `HTTP ${String(status)}: the server redirected${target}. Redirects are not followed; set the destination URL to the final address.`;
}
