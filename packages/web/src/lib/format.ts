// ===========================================
// Display Formatting
// ===========================================
// Server enums (CHANNEL_ERROR, USER_LOGIN, admin) are identifiers, not labels.
// Pages show them through these helpers so every list reads the same way.

/**
 * Turn an enum-style identifier into a sentence-case label.
 * `CHANNEL_ERROR` → "Channel error", `user-login` → "User login", `admin` → "Admin".
 */
export function humanize(value: string): string {
  const words = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
