// ===========================================
// HL7v2 Timestamp Formatting
// ===========================================
// Shared HL7 timestamp utility used by ACK generation and message generation.

/** Options for {@link formatTimestamp}. */
export interface TimestampOptions {
  /** Append the local UTC offset (`+HHMM`/`-HHMM`), so the time names one instant. */
  readonly utcOffset?: boolean;
}

/**
 * Format a Date as YYYYMMDDHHmmss (HL7 timestamp format) in local time,
 * followed by the UTC offset when `options.utcOffset` is set.
 */
export function formatTimestamp(date: Date, options?: TimestampOptions): string {
  const y = String(date.getFullYear());
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const base = `${y}${mo}${d}${h}${mi}${s}`;
  return options?.utcOffset === true ? `${base}${utcOffsetOf(date)}` : base;
}

/** The local UTC offset at `date` as HL7 writes it: `+HHMM` or `-HHMM`. */
function utcOffsetOf(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${minutes < 0 ? '-' : '+'}${hh}${mm}`;
}
