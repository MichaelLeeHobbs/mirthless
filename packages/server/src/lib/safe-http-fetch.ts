// SSRF guard for the httpFetch() script bridge. Every resolved address is
// checked inside the socket's `lookup`, and the connection uses exactly the
// address that was checked (no second lookup, so no DNS rebinding). Redirects
// are never followed and the body is capped, for allowlisted hosts too.

import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import { decodeAnswer } from '@galvanigraph/connectors';
import { isAllowedHost, isBlockedAddress, isBlockedHostname, type HttpFetchOptions, type HttpFetchResult } from '@galvanigraph/engine';
import logger from './logger.js';

export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 30_000;

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

/** An allowlisted host skips the address checks, here and in the lookup. */
function vetUrl(url: string, allowedHosts: ReadonlyArray<string>): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`httpFetch only supports http and https URLs, not ${parsed.protocol}`);
  }
  if (!isAllowedHost(parsed.hostname, allowedHosts) && isBlockedHostname(parsed.hostname)) {
    throw new Error(`SSRF blocked: requests to ${parsed.hostname} are not allowed`);
  }
  return parsed;
}

function readCapped(res: http.IncomingMessage): Promise<Buffer> {
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
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

function bodyText(bytes: Buffer, res: http.IncomingMessage, host: string): string {
  const contentType = res.headers['content-type'] ?? null;
  const { text, problem } = decodeAnswer(bytes, { contentType, contentEncoding: res.headers['content-encoding'] });
  if (problem !== null) {
    logger.warn(
      { host, status: res.statusCode ?? 0, contentType, problem },
      'The answer to an httpFetch could not be read as it was sent; bytes that could not be read are U+FFFD',
    );
  }
  return text;
}

function toHeaders(res: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/** `allowedHosts`: host names or IP literals from SCRIPT_HTTP_ALLOWED_HOSTS. */
export function safeHttpFetch(
  url: string,
  options: HttpFetchOptions,
  allowedHosts: ReadonlyArray<string> = [],
): Promise<HttpFetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = vetUrl(url, allowedHosts);
    const allowed = isAllowedHost(parsed.hostname, allowedHosts);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: options.method ?? 'GET',
      headers: { ...(options.headers ?? {}) },
      ...(allowed ? {} : { lookup: guardedLookup }),
      signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS),
    }, (res) => {
      readCapped(res).then(
        (bytes) => resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: toHeaders(res), body: bodyText(bytes, res, parsed.host) }),
      ).catch(reject);
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}
