// ===========================================
// HTTP Dispatcher Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { HttpDispatcher, type HttpDispatcherConfig } from '../http-dispatcher.js';
import type { ConnectorMessage } from '../../base.js';

// ----- Helpers -----

const DEST_PORT = 18662;

function makeConfig(overrides?: Partial<HttpDispatcherConfig>): HttpDispatcherConfig {
  return {
    url: `http://127.0.0.1:${String(DEST_PORT)}/receive`,
    method: 'POST',
    headers: {},
    contentType: 'text/plain',
    responseTimeout: 5_000,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: '00000000-0000-0000-0000-000000000001',
    messageId: 1,
    metaDataId: 1,
    content: 'MSH|^~\\&|SENDER',
    dataType: 'HL7V2',
    ...overrides,
  };
}

interface MockServer {
  readonly server: http.Server;
  readonly close: () => Promise<void>;
  readonly requests: Array<{ method: string; url: string; body: string; headers: http.IncomingHttpHeaders }>;
}

function createMockServer(
  port: number,
  handler?: (req: http.IncomingMessage, body: string) => { status: number; body: string },
): MockServer {
  const requests: MockServer['requests'] = [];
  const defaultHandler = (): { status: number; body: string } => ({ status: 200, body: 'OK' });
  const requestHandler = handler ?? defaultHandler;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        body,
        headers: req.headers,
      });
      const result = requestHandler(req, body);
      res.writeHead(result.status, { 'Content-Type': 'text/plain' });
      res.end(result.body);
    });
  });

  server.listen(port, '127.0.0.1');

  return {
    server,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
    requests,
  };
}

// ----- Lifecycle -----

let dispatcher: HttpDispatcher | null = null;
let mockServer: MockServer | null = null;

afterEach(async () => {
  if (dispatcher) {
    await dispatcher.onStop();
    await dispatcher.onUndeploy();
    dispatcher = null;
  }
  if (mockServer) {
    await mockServer.close();
    mockServer = null;
  }
});

// ----- Tests -----

describe('HttpDispatcher', () => {
  it('validates missing URL on deploy', async () => {
    dispatcher = new HttpDispatcher(makeConfig({ url: '' }));
    const result = await dispatcher.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('validates invalid URL on deploy', async () => {
    dispatcher = new HttpDispatcher(makeConfig({ url: 'not-a-url' }));
    const result = await dispatcher.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('validates invalid method on deploy', async () => {
    dispatcher = new HttpDispatcher(makeConfig({ method: 'INVALID' }));
    const result = await dispatcher.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('deploys with valid config', async () => {
    dispatcher = new HttpDispatcher(makeConfig());
    const result = await dispatcher.onDeploy();

    expect(result.ok).toBe(true);
  });

  it('sends message and receives response', async () => {
    mockServer = createMockServer(DEST_PORT);
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new HttpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(result.value.content).toBe('OK');
  });

  it('returns ERROR for non-2xx response', async () => {
    mockServer = createMockServer(DEST_PORT, () => ({ status: 500, body: 'Server Error' }));
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new HttpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.content).toBe('Server Error');
    expect(result.value.errorMessage).toBe('HTTP 500');
  });

  it('sends correct content and headers', async () => {
    mockServer = createMockServer(DEST_PORT);
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new HttpDispatcher(makeConfig({
      contentType: 'application/json',
      headers: { 'X-Custom': 'test-value' },
    }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    await dispatcher.send(
      makeMessage({ content: '{"msg":"hello"}' }),
      AbortSignal.timeout(5_000),
    );

    expect(mockServer.requests).toHaveLength(1);
    const req = mockServer.requests[0]!;
    expect(req.body).toBe('{"msg":"hello"}');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-custom']).toBe('test-value');
  });

  it('sends with custom method (PUT)', async () => {
    mockServer = createMockServer(DEST_PORT);
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new HttpDispatcher(makeConfig({ method: 'PUT' }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(mockServer.requests[0]!.method).toBe('PUT');
  });

  it('errors when dispatcher not started', async () => {
    dispatcher = new HttpDispatcher(makeConfig());

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(false);
  });

  it('errors when signal is already aborted', async () => {
    mockServer = createMockServer(DEST_PORT);
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new HttpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const controller = new AbortController();
    controller.abort();

    const result = await dispatcher.send(makeMessage(), controller.signal);

    expect(result.ok).toBe(false);
  });

  it('captures response body', async () => {
    mockServer = createMockServer(DEST_PORT, () => ({ status: 200, body: 'Response payload here' }));
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new HttpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Response payload here');
  });
});
