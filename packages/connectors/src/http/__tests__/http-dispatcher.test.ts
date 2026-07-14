// ===========================================
// HTTP Dispatcher Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import { HttpDispatcher, type HttpDispatcherConfig } from '../http-dispatcher.js';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';
import type { ConnectorMessage } from '../../base.js';

// ----- Helpers -----

const DEST_PORT = 18662;
const DEST_HTTPS_PORT = 18663;

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

/**
 * A mock HTTPS server using the self-signed test cert (CN=localhost,
 * SAN 127.0.0.1). Always replies 200 "SECURE-OK".
 */
function createMockHttpsServer(port: number): { server: https.Server; close: () => Promise<void> } {
  const server = https.createServer(
    { cert: TEST_CERT_PEM, key: TEST_KEY_PEM },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('SECURE-OK');
      });
    },
  );
  server.listen(port, '127.0.0.1');
  return {
    server,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
  };
}

// ----- Lifecycle -----

let dispatcher: HttpDispatcher | null = null;
let mockServer: MockServer | null = null;
let mockHttpsServer: { server: https.Server; close: () => Promise<void> } | null = null;

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
  if (mockHttpsServer) {
    await mockHttpsServer.close();
    mockHttpsServer = null;
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

  // ----- TLS / HTTPS -----

  const httpsUrl = `https://127.0.0.1:${String(DEST_HTTPS_PORT)}/receive`;

  async function startHttpsServer(): Promise<void> {
    mockHttpsServer = createMockHttpsServer(DEST_HTTPS_PORT);
    await new Promise<void>((resolve) => {
      mockHttpsServer!.server.once('listening', resolve);
    });
  }

  it('sends over HTTPS when the server CA is trusted via tls.ca', async () => {
    await startHttpsServer();

    dispatcher = new HttpDispatcher(makeConfig({
      url: httpsUrl,
      tls: { ca: TEST_CERT_PEM },
    }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(result.value.content).toBe('SECURE-OK');
  });

  it('accepts a self-signed cert when rejectUnauthorized is false (no CA)', async () => {
    await startHttpsServer();

    dispatcher = new HttpDispatcher(makeConfig({
      url: httpsUrl,
      tls: { rejectUnauthorized: false },
    }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(result.value.content).toBe('SECURE-OK');
  });

  it('rejects a self-signed HTTPS server when no TLS options are provided', async () => {
    await startHttpsServer();

    // No tls options → routed through fetch, which rejects the untrusted cert.
    dispatcher = new HttpDispatcher(makeConfig({ url: httpsUrl }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(false);
  });

  it('surfaces a TLS verification failure over node:https as a failed Result', async () => {
    await startHttpsServer();

    // Client cert activates the node:https path; with verification ON and the
    // server's self-signed cert NOT in the trust store, verification must fail.
    dispatcher = new HttpDispatcher(makeConfig({
      url: httpsUrl,
      tls: { cert: TEST_CERT_PEM, key: TEST_KEY_PEM, rejectUnauthorized: true },
    }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(false);
  });

  it('sends the request body over HTTPS for non-GET methods', async () => {
    let received = '';
    mockHttpsServer = {
      server: https.createServer({ cert: TEST_CERT_PEM, key: TEST_KEY_PEM }, (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => { chunks.push(c); });
        req.on('end', () => {
          received = Buffer.concat(chunks).toString('utf-8');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
        });
      }),
      close: () => new Promise<void>((resolve) => { mockHttpsServer!.server.close(() => { resolve(); }); }),
    };
    mockHttpsServer.server.listen(DEST_HTTPS_PORT, '127.0.0.1');
    await new Promise<void>((resolve) => { mockHttpsServer!.server.once('listening', resolve); });

    dispatcher = new HttpDispatcher(makeConfig({
      url: httpsUrl,
      tls: { ca: TEST_CERT_PEM },
    }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    await dispatcher.send(makeMessage({ content: 'PAYLOAD-42' }), AbortSignal.timeout(5_000));

    expect(received).toBe('PAYLOAD-42');
  });
});
