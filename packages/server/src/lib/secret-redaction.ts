// ===========================================
// Secret Redaction
// ===========================================
// Masks secret-typed setting values and secret connector properties before they
// leave the server in GET / export responses. Values are never returned in the
// clear to a read-level caller — only overwritten via explicit writes.

/** Masked stand-in returned in place of a real secret that has a value. */
export const REDACTED = '__REDACTED__';

/** Setting `type` values that denote a secret whose value must be masked. */
const SECRET_SETTING_TYPES: ReadonlySet<string> = new Set(['password', 'secret']);

/**
 * Connector property keys (case-insensitive) that hold credentials. Matched as a
 * substring so `authPass`, `smtpPassword`, `privateKeyPem`, `apiSecret`, etc. are
 * all covered.
 */
const SECRET_KEY_FRAGMENTS: readonly string[] = [
  'pass', // covers password, passwd, authPass, passphrase
  'secret',
  'privatekey',
  'apikey',
  'token',
  'credential',
];

/**
 * Setting keys that hold secrets even when their `type` was seeded as a plain
 * string on an older database (e.g. `smtp.auth_pass`).
 */
const SECRET_SETTING_KEY_RE = /(password|passwd|_pass$|secret|token|apikey|api_key|private_?key|passphrase|credential)/i;

/** True when a setting's type marks it as a secret. */
export function isSecretSettingType(type: string | null | undefined): boolean {
  return typeof type === 'string' && SECRET_SETTING_TYPES.has(type.toLowerCase());
}

/** True when a setting is a secret, by type OR by key naming. */
export function isSecretSetting(key: string, type: string | null | undefined): boolean {
  return isSecretSettingType(type) || SECRET_SETTING_KEY_RE.test(key);
}

/** True when a connector property key looks like a credential field. */
export function isSecretPropertyKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Redact a single setting value: mask a present secret value, pass through empty
 * / null (nothing to hide) and non-secret values unchanged. A setting is secret
 * by its `type` OR by its key naming.
 */
export function redactSettingValue(key: string, type: string | null | undefined, value: string | null): string | null {
  if (!isSecretSetting(key, type)) {
    return value;
  }
  return value !== null && value.length > 0 ? REDACTED : value;
}

/**
 * Return a shallow copy of connector `properties` with any secret-looking value
 * replaced by the REDACTED marker. Non-string secrets that are present are also
 * masked; empty/nullish values pass through so the caller can see "unset".
 */
export function redactConnectorProperties(
  properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (isSecretPropertyKey(key) && value !== null && value !== undefined && value !== '') {
      out[key] = REDACTED;
    } else {
      out[key] = value;
    }
  }
  return out;
}
