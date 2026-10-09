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
  'apikey', // also X-API-Key once separators are stripped
  'token',
  'credential',
  'authorization', // HTTP header values
  'cookie',
];

/**
 * Keys that are secrets only as an exact match: `key` is the inline TLS private
 * key PEM (`tls.key`); as a fragment it would also hit `keyColumn` and friends.
 */
const SECRET_EXACT_KEYS: ReadonlySet<string> = new Set(['key']);

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
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return SECRET_EXACT_KEYS.has(lower) || SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Return a deep copy of connector `properties` with every secret-looking value
 * replaced by the REDACTED marker, at any depth (nested `auth.password`, inline
 * `tls.key` PEMs, `headers.Authorization`). Non-string secrets that are present
 * are also masked; empty/nullish values pass through so the caller can see
 * "unset". Iterative (explicit stack) per the coding standard.
 */
export function redactConnectorProperties(
  properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<[Readonly<Record<string, unknown>>, Record<string, unknown>]> = [[properties, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop()!;
    for (const [key, value] of Object.entries(src)) {
      if (isSecretPropertyKey(key) && value !== null && value !== undefined && value !== '') {
        dst[key] = REDACTED;
      } else if (isPlainObject(value)) {
        const copy: Record<string, unknown> = {};
        dst[key] = copy;
        stack.push([value, copy]);
      } else if (Array.isArray(value)) {
        const items: unknown[] = value.map((item) => (isPlainObject(item) ? {} : item));
        dst[key] = items;
        value.forEach((item, i) => { if (isPlainObject(item)) stack.push([item, items[i] as Record<string, unknown>]); });
      } else {
        dst[key] = value;
      }
    }
  }
  return root;
}

/**
 * Redact the connector properties in a channel detail (or a revision snapshot,
 * which has the same shape): the source connector properties and each
 * destination's properties.
 */
export function redactChannelDetail(detail: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const source = detail['sourceConnectorProperties'];
  const destinations = detail['destinations'];
  return {
    ...detail,
    sourceConnectorProperties: isPlainObject(source) ? redactConnectorProperties(source) : source,
    destinations: Array.isArray(destinations)
      ? destinations.map((d: unknown) =>
          isPlainObject(d) && isPlainObject(d['properties'])
            ? { ...d, properties: redactConnectorProperties(d['properties']) }
            : d)
      : destinations,
  };
}
