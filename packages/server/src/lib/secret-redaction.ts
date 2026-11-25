// A secret never leaves the server in the clear to a read-level caller; it is
// only overwritten by an explicit write.

import { isDeepStrictEqual } from 'node:util';
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

/** `pw` only as a word of its own: Mirth's `keyStorePW`, not `spw`. */
const SECRET_KEY_ENDING = /(?:^|[-_])[Pp][Ww]$|[a-z0-9]P[Ww]$|[Pp][Ww][Dd]$/;

export function isSecretPropertyKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return SECRET_EXACT_KEYS.has(lower) || SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment)) || SECRET_KEY_ENDING.test(key);
}

/** Everything before the user info or the host. The URL parser needs no slashes after a scheme it knows, and a `${name}` may stand for any part. */
const BEFORE_AUTHORITY = /^[^/\\?#@]*[/\\]{2,}|^[^a-z]*(?:https?|wss?|ftp):[/\\]?/i;

/** Filled elsewhere, so it holds no credential. An import to a new server would lose it with the mask. */
const PLACEHOLDERS_ONLY = /^(?:\$\{[^}]*\}|:)+$/;

function maskQuery(query: string): string {
  return query.split('&').map((pair) => {
    const [parameter] = new URLSearchParams(pair);
    if (parameter === undefined || parameter[1] === '' || !isSecretPropertyKey(parameter[0])) return pair;
    const start = pair.indexOf('=') + 1;
    return PLACEHOLDERS_ONLY.test(pair.slice(start)) ? pair : pair.slice(0, start) + REDACTED;
  }).join('&');
}

/** Masks the user info and the secret query parameters, read as the URL parser reads them: it drops tabs and line ends. */
function maskUrl(text: string): string {
  const plain = text.replace(/[\t\n\r]/g, '');
  const start = BEFORE_AUTHORITY.exec(plain)?.[0] ?? '';
  const authority = /^[^/?#]*/.exec(plain.slice(start.length))?.[0] ?? '';
  const at = authority.lastIndexOf('@');
  const host = at < 0 || PLACEHOLDERS_ONLY.test(authority.slice(0, at)) ? authority : REDACTED + authority.slice(at);
  const tail = plain.slice(start.length + authority.length)
    .replace(/^([^?#]*\?)([^#]*)/, (_all, path: string, query: string) => path + maskQuery(query));
  const masked = start + host + tail;
  return masked === plain ? text : masked;
}

/** Reads a `Name: value` line as parseHeaderLines does. One it would ignore is masked whole, since it may hold the rest of a credential. */
function maskHeaderLine(line: string): string {
  const colon = line.indexOf(':');
  const name = line.slice(0, Math.max(colon, 0)).trim();
  const value = (name === '' ? line : line.slice(colon + 1)).trim();
  if (value === '' || (name !== '' && !isSecretPropertyKey(name))) return line;
  const start = line.trimEnd().length - value.length;
  return line.slice(0, start) + REDACTED + line.slice(start + value.length);
}

const maskHeaderLines = (text: string): string => text.split('\n').map(maskHeaderLine).join('\n');

/**
 * For a connector's own settings: HTTP and FHIR headers may be saved as text.
 * Never other text, nor a parameter or a header that happens to have the name:
 * an import loses what an export masked.
 */
function textMask(key: string, ownSetting: boolean): ((text: string) => string) | undefined {
  if (!ownSetting) return undefined;
  if (key === 'headers') return maskHeaderLines;
  return /ur[li]$/i.test(key) ? maskUrl : undefined;
}

/** What an import keeps of text an export may have masked: the stored text when only the masks differ from it. */
function unmaskText(mask: (text: string) => string, text: string, stored: unknown): string | undefined {
  if (!text.includes(REDACTED)) return text;
  if (typeof stored === 'string' && stored !== text && mask(stored) === text) return stored;
  return mask === maskHeaderLines ? text.split('\n').filter((line) => !line.includes(REDACTED)).join('\n') : undefined;
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
      } else if (typeof value === 'string') {
        dst[key] = textMask(key, src === properties)?.(value) ?? value;
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
      const mask = textMask(key, src === props);
      if (value === REDACTED && mask !== maskHeaderLines) {
        if (isRestorableSecret(key, storedValue)) dst[key] = storedValue;
      } else if (isPlainObject(value)) {
        const copy: Record<string, unknown> = {};
        dst[key] = copy;
        stack.push([value, copy, storedValue]);
      } else if (Array.isArray(value)) {
        const kept = value.filter((item) => item !== REDACTED);
        const items: unknown[] = kept.map((item) => (isPlainObject(item) ? {} : item));
        dst[key] = items;
        kept.forEach((item, i) => {
          if (isPlainObject(item)) stack.push([item, items[i] as Record<string, unknown>, undefined]);
        });
      } else if (typeof value === 'string' && mask !== undefined) {
        const kept = unmaskText(mask, value, storedValue);
        if (kept !== undefined) dst[key] = kept;
      } else {
        dst[key] = value;
      }
    }
  }
  return root;
}

/** Whether saving these would write the mask in place of a credential. */
export function holdsRedacted(properties: Readonly<Record<string, unknown>>): boolean {
  return !isDeepStrictEqual(stripRedactedProperties(properties), properties);
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
