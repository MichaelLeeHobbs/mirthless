// ===========================================
// SSRF-safe HTTP fetch for the httpFetch() script bridge
// ===========================================
// Scripts may call public HTTP(S) endpoints but must not reach loopback, private,
// link-local (cloud metadata) or other reserved addresses. Three holes a
// hostname-only check leaves open are closed here:
//   * DNS names that resolve to blocked addresses: every resolved address is
//     checked inside the socket's `lookup`, and the connection uses exactly the
//     address that was checked (no second lookup, so no DNS rebinding);
//   * redirects: never followed — a 3xx is returned to the script as-is;
//   * unbounded responses: the body is capped at MAX_RESPONSE_BYTES.

import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isBlockedAddress, isBlockedHostname, type HttpFetchOptions, type HttpFetchResult } from '@mirthless/engine';

/** Cap on a response body read into a script (bytes). */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 30_000;

/** A `lookup` that refuses to connect when any resolved address is blocked. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) { callback(err, '', 0); return; }
    const blocked = addresses.find((a) => isBlockedAddress(a.address));
    if (blocked || addresses.length === 0) {
      callback(new Error(`SSRF blocked: ${hostname} resolves to a disallowed address`), '', 0);
      return;
    }
    if (options.all) { callback(null, addresses); return; }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
};

/** Parse and vet the URL before any network activity. */
function vetUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`httpFetch only supports http and https URLs, not ${parsed.protocol}`);
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error(`SSRF blocked: requests to ${parsed.hostname} are not allowed`);
  }
  return parsed;
}

/** Read a response body as UTF-8, failing once it exceeds the cap. */
function readCapped(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        res.destroy(new Error(`httpFetch response exceeds ${String(MAX_RESPONSE_BYTES)} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

function toHeaders(res: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/** Perform one outbound request for a script under the SSRF policy above. */
export function safeHttpFetch(url: string, options: HttpFetchOptions): Promise<HttpFetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = vetUrl(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: options.method ?? 'GET',
      headers: { ...(options.headers ?? {}) },
      lookup: guardedLookup,
      signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS),
    }, (res) => {
      readCapped(res).then(
        (body) => resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: toHeaders(res), body }),
        reject,
      );
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}
