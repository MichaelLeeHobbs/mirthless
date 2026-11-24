// A secret never leaves the server in the clear to a read-level caller; it is
// only overwritten by an explicit write.

import { isPlainObject, isSecretSetting } from '@galvanigraph/core-util';

export const REDACTED = '__REDACTED__';

const SECRET_KEY_FRAGMENTS: readonly string[] = [
  'pass', // covers password, passwd, authPass, passphrase
  'secret',
  'privatekey',
  'apikey', // also X-API-Key once separators are stripped
  'token',
  'credential',
  'authorization',
  'cookie',
];

/** `key` is the inline TLS private key PEM; as a fragment it would also hit `keyColumn`. */
const SECRET_EXACT_KEYS: ReadonlySet<string> = new Set(['key']);

export function isSecretPropertyKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return SECRET_EXACT_KEYS.has(lower) || SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

export function redactSettingValue(key: string, type: string | null | undefined, value: string | null): string | null {
  if (!isSecretSetting(key, type)) {
    return value;
  }
  return value !== null && value.length > 0 ? REDACTED : value;
}

/** Empty and nullish secrets pass through so the caller can see "unset". */
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
 * Exports mask credentials as REDACTED; importing the marker would write it over
 * a real password. With the key dropped the secret is absent, so the connector
 * fails loud at deploy instead of authenticating with a bogus value.
 */
export function stripRedactedProperties(props: unknown): Record<string, unknown> {
  if (!isPlainObject(props)) return {};
  const root: Record<string, unknown> = {};
  // Exports redact at any depth (nested auth/tls/headers), so strip at any depth.
  const stack: Array<[Record<string, unknown>, Record<string, unknown>]> = [[props, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop()!;
    for (const [key, value] of Object.entries(src)) {
      if (value === REDACTED) continue;
      if (isPlainObject(value)) {
        const copy: Record<string, unknown> = {};
        dst[key] = copy;
        stack.push([value, copy]);
      } else if (Array.isArray(value)) {
        const kept = value.filter((item) => item !== REDACTED);
        const items: unknown[] = kept.map((item) => (isPlainObject(item) ? {} : item));
        dst[key] = items;
        kept.forEach((item, i) => {
          if (isPlainObject(item)) stack.push([item, items[i] as Record<string, unknown>]);
        });
      } else {
        dst[key] = value;
      }
    }
  }
  return root;
}

/** Also takes a revision snapshot, which has the same shape. */
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
