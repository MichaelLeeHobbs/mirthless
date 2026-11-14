// ===========================================
// Display Formatting
// ===========================================
// Server enums (CHANNEL_ERROR, USER_LOGIN, admin) are identifiers, not labels.
// Pages show them through these helpers so every list reads the same way.

interface TimestampOptions {
  /** Shown when there is no timestamp. Defaults to "—". */
  readonly empty?: string;
  /** Date without the time of day. */
  readonly dateOnly?: boolean;
}

/**
 * An ISO timestamp in the browser's locale. A missing value shows `empty`
 * rather than the 1970 epoch, and an unparseable one shows as it came rather
 * than "Invalid Date". Relative times and the log viewer's clock are separate
 * views with their own formatters.
 */
export function formatTimestamp(value: string | null | undefined, options: TimestampOptions = {}): string {
  if (value === null || value === undefined || value === '') return options.empty ?? '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return options.dateOnly === true ? date.toLocaleDateString() : date.toLocaleString();
}

/**
 * Turn an enum-style identifier into a sentence-case label.
 * `CHANNEL_ERROR` → "Channel error", `user-login` → "User login", `admin` → "Admin".
 */
export function humanize(value: string): string {
  const words = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
