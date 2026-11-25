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

/** `pw` as a word of its own: Mirth's `keyStorePW`, not `spw`. */
const SECRET_KEY_ENDING = /(?:^|[-_])[Pp][Ww][Dd]?$|[a-z0-9]P[Ww][Dd]?$/;

export function isSecretPropertyKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return SECRET_EXACT_KEYS.has(lower) || SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment)) || SECRET_KEY_ENDING.test(key);
}

/** The URL parser needs no slashes after these schemes, and takes a backslash for a slash. */
const SPECIAL_URL_START = /^\s*(?:https?|wss?|ftp):[/\\]*/i;
const URL_START = /^\s*[a-z][a-z0-9+.-]*:\/\//i;

function maskQuery(query: string): string {
  return query.split('&').map((pair) => {
    const [parameter] = new URLSearchParams(pair);
    const secret = parameter !== undefined && parameter[1] !== '' && isSecretPropertyKey(parameter[0]);
    return secret ? pair.slice(0, pair.indexOf('=') + 1) + REDACTED : pair;
  }).join('&');
}

/** Masks the user info and the secret query parameters of text that is a URL, read as the URL parser reads it. */
function maskUrl(text: string): string {
  const special = SPECIAL_URL_START.exec(text)?.[0];
  const start = special ?? URL_START.exec(text)?.[0];
  if (start === undefined) return text;
  const rest = text.slice(start.length);
  const authority = (special === undefined ? /^[^/?#]*/ : /^[^/\\?#]*/).exec(rest)?.[0] ?? '';
  const at = authority.lastIndexOf('@');
  const host = at < 0 ? authority : `${REDACTED}${authority.slice(at)}`;
  const tail = rest.slice(authority.length).replace(/^([^?#]*\?)([^#]*)/, (_all, path: string, query: string) => path + maskQuery(query));
  return start + host + tail;
}

/** Reads a `Name: value` line as parseHeaderLines does, and keeps its spacing. */
function maskHeaderLine(line: string): string {
  const colon = line.indexOf(':');
  const rest = line.slice(colon + 1);
  const value = rest.trim();
  if (colon < 0 || value === '') return line;
  const masked = isSecretPropertyKey(line.slice(0, colon).trim()) ? REDACTED : maskUrl(value);
  return line.slice(0, colon + 1) + rest.replace(value, () => masked);
}

/** HTTP and FHIR headers may be saved as text. */
function maskText(key: string, text: string): string {
  return key === 'headers' ? text.split('\n').map(maskHeaderLine).join('\n') : maskUrl(text);
}

/** What an import keeps of text an export may have masked: the stored text when only the masks differ from it. */
function unmaskText(key: string, text: string, stored: unknown): string | undefined {
  if (!text.includes(REDACTED)) return text;
  if (typeof stored === 'string' && stored !== text && maskText(key, stored) === text) return stored;
  if (key === 'headers') return text.split('\n').filter((line) => !line.includes(REDACTED)).join('\n');
  return isUrl(text) ? undefined : text;
}

function isUrl(text: string): boolean {
  return SPECIAL_URL_START.test(text) || URL_START.test(text);
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
        const items: unknown[] = value.map((item) => (isPlainObject(item) ? {} : typeof item === 'string' ? maskUrl(item) : item));
        dst[key] = items;
        value.forEach((item, i) => { if (isPlainObject(item)) stack.push([item, items[i] as Record<string, unknown>]); });
      } else if (typeof value === 'string') {
        dst[key] = maskText(key, value);
      } else {
        dst[key] = value;
      }
    }
  }
  return root;
}

function ownProperty(value: unknown, key: string): unknown {
  return isPlainObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

function isRestorableSecret(key: string, stored: unknown): boolean {
  return isSecretPropertyKey(key) && typeof stored === 'string' && stored !== '' && stored !== REDACTED;
}

/** In a list, what holds the marker is dropped: its entries have no identity to match a stored one by. */
function holdsMarker(item: unknown): boolean {
  return typeof item === 'string' && (item === REDACTED || (item.includes(REDACTED) && isUrl(item)));
}

/**
 * Exports mask credentials as REDACTED; importing the marker would write it over
 * a real password. With the key dropped the secret is absent, so the connector
 * fails loud at deploy instead of authenticating with a bogus value. A masked URL
 * is dropped whole for the same reason; without its user info it would deploy.
 *
 * With `stored`, a marker takes the secret stored at the same path instead.
 * Never inside a list, whose entries have no identity to match by. Whether the
 * connector may have it back is the caller's to decide (overwriteProperties).
 */
export function stripRedactedProperties(props: unknown, stored?: unknown): Record<string, unknown> {
  if (!isPlainObject(props)) return {};
  const root: Record<string, unknown> = {};
  // Exports redact at any depth (nested auth/tls/headers), so strip at any depth.
  const stack: Array<[Record<string, unknown>, Record<string, unknown>, unknown]> = [[props, root, stored]];
  while (stack.length > 0) {
    const [src, dst, storedHere] = stack.pop()!;
    for (const [key, value] of Object.entries(src)) {
      const storedValue = ownProperty(storedHere, key);
      if (value === REDACTED) {
        if (isRestorableSecret(key, storedValue)) dst[key] = storedValue;
      } else if (isPlainObject(value)) {
        const copy: Record<string, unknown> = {};
        dst[key] = copy;
        stack.push([value, copy, storedValue]);
      } else if (Array.isArray(value)) {
        const kept = value.filter((item) => !holdsMarker(item));
        const items: unknown[] = kept.map((item) => (isPlainObject(item) ? {} : item));
        dst[key] = items;
        kept.forEach((item, i) => {
          if (isPlainObject(item)) stack.push([item, items[i] as Record<string, unknown>, undefined]);
        });
      } else if (typeof value === 'string') {
        const kept = unmaskText(key, value, storedValue);
        if (kept !== undefined) dst[key] = kept;
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
