// ===========================================
// HTTP Receiver Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import { HttpReceiver, type HttpReceiverConfig } from '../http-receiver.js';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';

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
});
