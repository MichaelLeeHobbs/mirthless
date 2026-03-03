// ===========================================
// HL7v2 Timestamp Formatting
// ===========================================
// Shared HL7 timestamp utility used by ACK generation and message generation.

/** Format a Date as YYYYMMDDHHmmss (HL7 timestamp format). */
export function formatTimestamp(date: Date): string {
  const y = String(date.getFullYear());
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}${h}${mi}${s}`;
}
