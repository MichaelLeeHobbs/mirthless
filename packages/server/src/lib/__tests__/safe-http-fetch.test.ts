// ===========================================
// safeHttpFetch Tests
// ===========================================
// DNS is mocked (external boundary) so names resolve to chosen addresses. The
// transport tests talk to a real local HTTP server; for those, the address policy
// is narrowed to 10.0.0.0/8 so loopback is reachable without weakening the
// production policy, which is tested on its own in the engine package.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const resolveTo = vi.hoisted(() => ({ address: '127.0.0.1', family: 4 }));
const policy = vi.hoisted(() => ({ narrow: false }));

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  return {
    ...actual,
    lookup: (_host: string, _opts: unknown, cb: (e: Error | null, a: Array<{ address: string; family: number }>) => void) => {
      cb(null, [{ ...resolveTo }]);
    },
  };
});

vi.mock('@mirthless/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mirthless/engine')>();
  return {
    ...actual,
    isBlockedAddress: (a: string) => (policy.narrow ? a.startsWith('10.') : actual.isBlockedAddress(a)),
    isBlockedHostname: (h: string) => (policy.narrow ? false : actual.isBlockedHostname(h)),
  };
});

const { safeHttpFetch, MAX_RESPONSE_BYTES } = await import('../safe-http-fetch.js');

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); return; }
    if (req.url === '/huge') { res.writeHead(200); res.end(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'a')); return; }
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'text/plain', 'x-echo-method': req.method ?? '' });
      res.end(`${req.headers['x-api-key'] ?? ''}|${body}`);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  policy.narrow = false;
  resolveTo.address = '127.0.0.1';
});

describe('safeHttpFetch — policy', () => {
  it.each(['http://[::1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://localhost./', 'http://169.254.169.254/latest'])(
    'refuses %s before connecting', async (url) => {
      await expect(safeHttpFetch(url, {})).rejects.toThrow(/SSRF blocked/);
    },
  );

  it('refuses a DNS name that resolves to a private address', async () => {
    resolveTo.address = '10.0.0.5';
    await expect(safeHttpFetch('http://internal.example/', {})).rejects.toThrow(/resolves to a disallowed address/);
  });

  it('refuses a DNS name that resolves to the metadata address', async () => {
    resolveTo.address = '169.254.169.254';
    await expect(safeHttpFetch('http://metadata.google.internal/', {})).rejects.toThrow(/disallowed address/);
  });

  it('refuses non-http protocols', async () => {
    await expect(safeHttpFetch('file:///etc/passwd', {})).rejects.toThrow(/only supports http/);
  });
});

describe('safeHttpFetch — transport', () => {
  beforeEach(() => { policy.narrow = true; });

  it('forwards method, headers and body and maps the response', async () => {
    const res = await safeHttpFetch(`http://api.test:${String(port)}/x`, {
      method: 'POST', headers: { 'x-api-key': 'k' }, body: '{"a":1}',
    });
    expect(res.status).toBe(201);
    expect(res.headers['x-echo-method']).toBe('POST');
    expect(res.body).toBe('k|{"a":1}');
  });

  it('returns a redirect to the script instead of following it', async () => {
    const res = await safeHttpFetch(`http://api.test:${String(port)}/redirect`, {});
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('http://169.254.169.254/');
  });

  it('fails when the response exceeds the size cap', async () => {
    await expect(safeHttpFetch(`http://api.test:${String(port)}/huge`, {})).rejects.toThrow(/exceeds/);
  });
});
