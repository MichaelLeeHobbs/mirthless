// ===========================================
// Secret Settings
// ===========================================
// Which system settings hold secrets. The server masks their values before
// they leave it, and the Settings page knows not to expect a value back.

/** Setting `type` values (any letter case) that mark a secret. */
const SECRET_SETTING_TYPES: ReadonlySet<string> = new Set(['password', 'secret']);

/**
 * Setting keys that hold secrets even when their `type` was seeded as a plain
 * string on an older database (e.g. `smtp.auth_pass`).
 */
const SECRET_SETTING_KEY_RE = /(password|passwd|_pass$|secret|token|apikey|api_key|private_?key|passphrase|credential)/i;

/**
 * True when a setting is a secret: its type is `password` or `secret` in any
 * letter case, or its key names a secret (password, token, API key and so on).
 */
export function isSecretSetting(key: string, type: string | null | undefined): boolean {
  const secretType = typeof type === 'string' && SECRET_SETTING_TYPES.has(type.toLowerCase());
  return secretType || SECRET_SETTING_KEY_RE.test(key);
}
