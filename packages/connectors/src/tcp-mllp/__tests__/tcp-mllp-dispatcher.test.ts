// ===========================================
// TCP/MLLP Dispatcher Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { TcpMllpDispatcher, type TcpMllpDispatcherConfig } from '../tcp-mllp-dispatcher.js';
import { wrapMllp, MllpParser } from '../../transmission/mllp-mode.js';
import type { ConnectorMessage } from '../../base.js';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';

// ----- Helpers -----

const DEST_PORT = 16662;

/** A full HL7 acknowledgement with the given MSA-1 code. */
function ackFrame(code: string): string {
  return `MSH|^~\\&|R|F|S|SF|20240101||ACK|1|P|2.5.1\rMSA|${code}|MSGID`;
}

function makeConfig(overrides?: Partial<TcpMllpDispatcherConfig>): TcpMllpDispatcherConfig {
  return {
    host: '127.0.0.1',
    port: DEST_PORT,
    maxConnections: 5,
    responseTimeout: 5_000,
    acquireTimeoutMs: 5_000,
    charset: 'utf-8',
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

/**
 * Create a mock TCP/MLLP server that echoes ACK for each received message.
 */
function createMockServer(
  port: number,
  handler?: (msg: string) => string,
): { server: net.Server; close: () => Promise<void> } {
  const ackHandler = handler ?? (() => 'MSA|AA|12345');

  const server = net.createServer((socket) => {
    const parser = new MllpParser();
    socket.on('data', (chunk: Buffer) => {
      const msgs = parser.parse(chunk);
      for (const msg of msgs) {
        const response = ackHandler(msg);
        socket.write(wrapMllp(response));
      }
    });
  });

  server.listen(port, '127.0.0.1');

  return {
    server,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
  };
}

// ----- Lifecycle -----

let dispatcher: TcpMllpDispatcher | null = null;
let mockServer: { server: net.Server; close: () => Promise<void> } | null = null;

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

describe('TcpMllpDispatcher', () => {
  it('validates config on deploy', async () => {
    dispatcher = new TcpMllpDispatcher(makeConfig({ port: 0 }));
    const result = await dispatcher.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('validates host on deploy', async () => {
    dispatcher = new TcpMllpDispatcher(makeConfig({ host: '' }));
    const result = await dispatcher.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('sends message and receives response', async () => {
    mockServer = createMockServer(DEST_PORT);
    // Wait for server to be ready
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(result.value.content).toBe('MSA|AA|12345');
  });

  it('sends custom content and gets custom response', async () => {
    mockServer = createMockServer(DEST_PORT, (msg) => `ACK:${msg}`);
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(
      makeMessage({ content: 'HELLO' }),
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('ACK:HELLO');
  });

  it('errors when dispatcher not started', async () => {
    dispatcher = new TcpMllpDispatcher(makeConfig());

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(false);
  });

  it('errors when signal is already aborted', async () => {
    mockServer = createMockServer(DEST_PORT);
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const controller = new AbortController();
    controller.abort();

    const result = await dispatcher.send(makeMessage(), controller.signal);

    expect(result.ok).toBe(false);
  });

  it('errors when abort signal fires during send', async () => {
    // Start a server that never responds
    const silentServer = net.createServer(() => {
      // Accept connection but never send data
    });
    silentServer.listen(16699, '127.0.0.1');
    await new Promise<void>((resolve) => {
      silentServer.once('listening', resolve);
    });

    dispatcher = new TcpMllpDispatcher(makeConfig({ port: 16699, responseTimeout: 30_000 }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const controller = new AbortController();
    // Abort after 200ms
    setTimeout(() => { controller.abort(); }, 200);

    const result = await dispatcher.send(makeMessage(), controller.signal);
    expect(result.ok).toBe(false);

    silentServer.close();
  });

  it('reuses connections from pool', async () => {
    let connectionCount = 0;
    mockServer = createMockServer(DEST_PORT);
    mockServer.server.on('connection', () => { connectionCount++; });
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    // Send two messages — should reuse connection
    await dispatcher.send(makeMessage({ messageId: 1 }), AbortSignal.timeout(5_000));
    await dispatcher.send(makeMessage({ messageId: 2 }), AbortSignal.timeout(5_000));

    expect(connectionCount).toBe(1);
  });

  it('stops and clears pool without error', async () => {
    mockServer = createMockServer(DEST_PORT);
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });

    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    // Use a connection
    await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    const stopResult = await dispatcher.onStop();
    expect(stopResult.ok).toBe(true);

    dispatcher = null; // Already stopped
  });
});

describe('TcpMllpDispatcher acknowledgement validation', () => {
  it('marks an AA acknowledgement as SENT', async () => {
    mockServer = createMockServer(DEST_PORT, () => ackFrame('AA'));
    await new Promise<void>((r) => mockServer!.server.once('listening', r));
    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
  });

  it('marks an AE negative acknowledgement as ERROR (not a silent SENT)', async () => {
    mockServer = createMockServer(DEST_PORT, () => ackFrame('AE'));
    await new Promise<void>((r) => mockServer!.server.once('listening', r));
    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.errorMessage).toContain('AE');
  });

  it('marks an AR rejection as ERROR', async () => {
    mockServer = createMockServer(DEST_PORT, () => ackFrame('AR'));
    await new Promise<void>((r) => mockServer!.server.once('listening', r));
    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
  });

  it('marks an unparseable response as ERROR with a clear message', async () => {
    mockServer = createMockServer(DEST_PORT, () => 'not-an-hl7-ack');
    await new Promise<void>((r) => mockServer!.server.once('listening', r));
    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.errorMessage).toContain('Unparseable');
  });
});

describe('TcpMllpDispatcher resilience', () => {
  it('does not crash and evicts an idle pooled socket that errors', async () => {
    let connectionCount = 0;
    let serverSocket: net.Socket | null = null;
    const server = net.createServer((socket) => {
      connectionCount++;
      serverSocket = socket;
      const parser = new MllpParser();
      socket.on('data', (chunk: Buffer) => {
        for (const _msg of parser.parse(chunk)) socket.write(wrapMllp(ackFrame('AA')));
      });
      socket.on('error', () => { /* ignore RST on the server side */ });
    });
    server.listen(DEST_PORT, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    mockServer = { server, close: () => new Promise<void>((r) => server.close(() => r())) };

    dispatcher = new TcpMllpDispatcher(makeConfig());
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const first = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
    expect(first.ok).toBe(true);

    // Force a reset on the now-idle pooled socket — with no persistent error
    // handler this would become an uncaughtException that crashes the engine.
    serverSocket!.resetAndDestroy();
    await new Promise<void>((r) => setTimeout(r, 150));

    // A subsequent send must still succeed on a fresh connection.
    const second = await dispatcher.send(makeMessage({ messageId: 2 }), AbortSignal.timeout(5_000));
    expect(second.ok).toBe(true);
    expect(connectionCount).toBe(2);
  });

  it('fails promptly when the destination host is down (no indefinite hang)', async () => {
    // Nothing listening on this port → connect refused.
    dispatcher = new TcpMllpDispatcher(makeConfig({ port: 16689, acquireTimeoutMs: 3_000 }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(10_000));
    expect(result.ok).toBe(false);
  });

  it('sends over TLS and validates the acknowledgement', async () => {
    const server = tls.createServer({ cert: TEST_CERT_PEM, key: TEST_KEY_PEM }, (socket) => {
      const parser = new MllpParser();
      socket.on('data', (chunk: Buffer) => {
        for (const _msg of parser.parse(chunk)) socket.write(wrapMllp(ackFrame('AA')));
      });
    });
    server.listen(DEST_PORT, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    mockServer = { server: server as unknown as net.Server, close: () => new Promise<void>((r) => server.close(() => r())) };

    dispatcher = new TcpMllpDispatcher(makeConfig({ tls: { ca: TEST_CERT_PEM } }));
    await dispatcher.onDeploy();
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
  });
});
