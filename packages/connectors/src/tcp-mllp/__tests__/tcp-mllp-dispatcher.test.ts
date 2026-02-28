// ===========================================
// TCP/MLLP Dispatcher Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { TcpMllpDispatcher, type TcpMllpDispatcherConfig } from '../tcp-mllp-dispatcher.js';
import { wrapMllp, MllpParser } from '../../transmission/mllp-mode.js';
import type { ConnectorMessage } from '../../base.js';

// ----- Helpers -----

const DEST_PORT = 16662;

function makeConfig(overrides?: Partial<TcpMllpDispatcherConfig>): TcpMllpDispatcherConfig {
  return {
    host: '127.0.0.1',
    port: DEST_PORT,
    maxConnections: 5,
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
