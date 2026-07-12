// ===========================================
// HTTP Receiver Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import {
  HttpReceiver,
  DEFAULT_MAX_BODY_BYTES,
  type HttpReceiverConfig,
} from '../http-receiver.js';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';

// ----- Helpers -----

const TEST_PORT = 18661;

function makeConfig(overrides?: Partial<HttpReceiverConfig>): HttpReceiverConfig {
  return {
    host: '127.0.0.1',
    port: TEST_PORT,
    path: '/',
    method: 'POST',
    responseContentType: 'text/plain',
    responseStatusCode: 200,
    errorStatusCode: 500,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    ...overrides,
  };
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler
      ? handler(raw)
      : { messageId: 1, response: 'OK' },
    error: null,
  });
}

/** Dispatcher that always returns a failed Result. */
function failingDispatcher(): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async () => ({ ok: false as const, value: null, error: new Error('pipeline down') });
}

async function sendRequest(
  port: number,
  options: {
    method?: string;
    path?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const { method = 'POST', path = '/', body, headers = {} } = options;
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method,
    body,
    headers,
    signal: AbortSignal.timeout(5_000),
  });

  const responseBody = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return { status: response.status, body: responseBody, headers: responseHeaders };
}

// ----- Lifecycle -----

let receiver: HttpReceiver | null = null;

afterEach(async () => {
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

// ----- Tests -----

describe('HttpReceiver', () => {
  it('validates port on deploy', async () => {
    receiver = new HttpReceiver(makeConfig({ port: -1 }));
    const result = await receiver.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('validates method on deploy', async () => {
    receiver = new HttpReceiver(makeConfig({ method: 'INVALID' }));
    const result = await receiver.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('deploys with valid config', async () => {
    receiver = new HttpReceiver(makeConfig());
    const result = await receiver.onDeploy();

    expect(result.ok).toBe(true);
  });

  it('starts and stops without error', async () => {
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());

    const deployResult = await receiver.onDeploy();
    expect(deployResult.ok).toBe(true);

    const startResult = await receiver.onStart();
    expect(startResult.ok).toBe(true);

    const stopResult = await receiver.onStop();
    expect(stopResult.ok).toBe(true);

    receiver = null; // Already stopped
  });

  it('errors on start if dispatcher not set', async () => {
    receiver = new HttpReceiver(makeConfig());

    const result = await receiver.onStart();

    expect(result.ok).toBe(false);
  });

  it('dispatches POST body as message content', async () => {
    let capturedRaw: RawMessage | null = null;

    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => {
      capturedRaw = raw;
      return { messageId: 1, response: 'ACK' };
    }));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await sendRequest(TEST_PORT, { body: 'Hello HL7' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('ACK');
    expect(capturedRaw).not.toBeNull();
    expect(capturedRaw!.content).toBe('Hello HL7');
  });

  it('passes sourceMap with HTTP metadata', async () => {
    let capturedRaw: RawMessage | null = null;

    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => {
      capturedRaw = raw;
      return { messageId: 1, response: 'OK' };
    }));
    await receiver.onDeploy();
    await receiver.onStart();

    await sendRequest(TEST_PORT, {
      body: 'test',
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'foo' },
    });

    expect(capturedRaw).not.toBeNull();
    expect(capturedRaw!.sourceMap['remoteAddress']).toBe('127.0.0.1');
    expect(capturedRaw!.sourceMap['method']).toBe('POST');
    expect(capturedRaw!.sourceMap['path']).toBe('/');
    expect(capturedRaw!.sourceMap['contentType']).toBe('application/json');
    const headers = capturedRaw!.sourceMap['headers'] as Record<string, string>;
    expect(headers['x-custom']).toBe('foo');
  });

  it('includes query string in sourceMap', async () => {
    let capturedRaw: RawMessage | null = null;

    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => {
      capturedRaw = raw;
      return { messageId: 1, response: 'OK' };
    }));
    await receiver.onDeploy();
    await receiver.onStart();

    await sendRequest(TEST_PORT, { path: '/?key=value&foo=bar', body: '' });

    const qs = capturedRaw!.sourceMap['queryString'] as Record<string, string>;
    expect(qs['key']).toBe('value');
    expect(qs['foo']).toBe('bar');
  });

  it('only matches configured method', async () => {
    receiver = new HttpReceiver(makeConfig({ method: 'POST' }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await sendRequest(TEST_PORT, { method: 'GET' });

    expect(response.status).toBe(405);
  });

  it('only matches configured path', async () => {
    receiver = new HttpReceiver(makeConfig({ path: '/api/receive' }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const wrongPath = await sendRequest(TEST_PORT, { path: '/other', body: 'test' });
    expect(wrongPath.status).toBe(404);

    const rightPath = await sendRequest(TEST_PORT, { path: '/api/receive', body: 'test' });
    expect(rightPath.status).toBe(200);
  });

  it('sends empty response when dispatcher returns no response', async () => {
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1 })));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await sendRequest(TEST_PORT, { body: 'test' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('');
  });

  it('halt force-closes server', async () => {
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const haltResult = await receiver.onHalt();
    expect(haltResult.ok).toBe(true);

    receiver = null; // Already halted
  });

  it('returns 500 when the pipeline dispatch fails (never a false 200)', async () => {
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(failingDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await sendRequest(TEST_PORT, { body: 'test' });

    expect(response.status).toBe(500);
  });

  it('returns the configured error status on failure', async () => {
    receiver = new HttpReceiver(makeConfig({ errorStatusCode: 502 }));
    receiver.setDispatcher(failingDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await sendRequest(TEST_PORT, { body: 'test' });

    expect(response.status).toBe(502);
  });

  it('returns 413 when the body exceeds the size cap', async () => {
    receiver = new HttpReceiver(makeConfig({ maxBodyBytes: 16 }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await sendRequest(TEST_PORT, { body: 'x'.repeat(1024) });

    expect(response.status).toBe(413);
  });
});

describe('HttpReceiver authentication', () => {
  it('rejects missing basic-auth with 401', async () => {
    receiver = new HttpReceiver(makeConfig({ auth: { type: 'BASIC', username: 'u', password: 'p' } }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await sendRequest(TEST_PORT, { body: 'test' });

    expect(response.status).toBe(401);
  });

  it('accepts valid basic-auth', async () => {
    receiver = new HttpReceiver(makeConfig({ auth: { type: 'BASIC', username: 'u', password: 'p' } }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const creds = Buffer.from('u:p').toString('base64');
    const response = await sendRequest(TEST_PORT, {
      body: 'test',
      headers: { Authorization: `Basic ${creds}` },
    });

    expect(response.status).toBe(200);
  });

  it('rejects a wrong bearer token and accepts the correct one', async () => {
    receiver = new HttpReceiver(makeConfig({ auth: { type: 'TOKEN', token: 'secret' } }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const bad = await sendRequest(TEST_PORT, { body: 't', headers: { Authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);

    const good = await sendRequest(TEST_PORT, { body: 't', headers: { Authorization: 'Bearer secret' } });
    expect(good.status).toBe(200);
  });
});

describe('HttpReceiver TLS', () => {
  it('serves over HTTPS and dispatches the body', async () => {
    receiver = new HttpReceiver(makeConfig({ tls: { cert: TEST_CERT_PEM, key: TEST_KEY_PEM } }));
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1, response: 'SECURE' })));
    await receiver.onDeploy();
    await receiver.onStart();

    const result = await httpsPost(TEST_PORT, 'test');

    expect(result.status).toBe(200);
    expect(result.body).toBe('SECURE');
  });
});

/** POST over HTTPS trusting the test CA. */
function httpsPost(port: number, body: string): Promise<{ status: number; body: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const https = require('node:https') as typeof import('node:https');
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port, path: '/', method: 'POST', ca: TEST_CERT_PEM },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
