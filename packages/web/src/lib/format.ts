// ===========================================
// Display Formatting
// ===========================================
// Server enums (CHANNEL_ERROR, USER_LOGIN, admin) are identifiers, not labels.
// Pages show them through these helpers so every list reads the same way.
// (CI probe for #177: a web-only change. This PR is not for merging.)

interface TimestampOptions {
  /** Shown when there is no timestamp. Defaults to "—". */
  readonly empty?: string;
  /** Date without the time of day. */
  readonly dateOnly?: boolean;
}

/**
 * The rule every timestamp on screen follows, with the caller's own view of a
 * valid time: a missing value (null, undefined or '') shows `empty` rather
 * than the 1970 epoch, and an unparseable one shows as it came rather than
 * "Invalid Date" or NaN digits. `render` only ever sees a valid Date.
 */
export function formatTimestampWith(
  value: string | null | undefined,
  render: (date: Date) => string,
  empty = '—',
): string {
  if (value === null || value === undefined || value === '') return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return render(date);
}

/**
 * An ISO timestamp in the browser's locale, following {@link formatTimestampWith}'s
 * rule for a missing or unparseable value. Relative times and the log viewer's
 * clock are other views of a valid time built on the same rule.
 */
export function formatTimestamp(value: string | null | undefined, options: TimestampOptions = {}): string {
  const render = options.dateOnly === true
    ? (date: Date): string => date.toLocaleDateString()
    : (date: Date): string => date.toLocaleString();
  return formatTimestampWith(value, render, options.empty);
}

/**
 * Turn an enum-style identifier into a sentence-case label.
 * `CHANNEL_ERROR` → "Channel error", `user-login` → "User login", `admin` → "Admin".
 */
export function humanize(value: string): string {
  const words = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
