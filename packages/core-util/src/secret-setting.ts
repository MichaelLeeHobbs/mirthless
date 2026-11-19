// The server masks these settings' values before they leave it, and the
// Settings page knows not to expect a value back.

const SECRET_SETTING_TYPES: ReadonlySet<string> = new Set(['password', 'secret']);

/**
 * Setting keys that hold secrets even when their `type` was seeded as a plain
 * string on an older database (e.g. `smtp.auth_pass`).
 */
const SECRET_SETTING_KEY_RE = /(password|passwd|_pass$|secret|token|apikey|api_key|private_?key|passphrase|credential)/i;

export function isSecretSetting(key: string, type: string | null | undefined): boolean {
  const secretType = typeof type === 'string' && SECRET_SETTING_TYPES.has(type.toLowerCase());
  return secretType || SECRET_SETTING_KEY_RE.test(key);
}
