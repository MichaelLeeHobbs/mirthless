// ===========================================
// Date Utilities
// ===========================================

/** Returns the current timestamp as an ISO 8601 string */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Returns the current timestamp as a Date object */
export function now(): Date {
  return new Date();
}
