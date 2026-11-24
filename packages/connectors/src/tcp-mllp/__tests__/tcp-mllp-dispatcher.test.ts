import { describe, it, expect, vi, afterEach } from 'vitest';
import * as diagnostics from 'node:diagnostics_channel';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { TcpMllpDispatcher, type TcpMllpDispatcherConfig } from '../tcp-mllp-dispatcher.js';
import { wrapMllp, MllpParser } from '../../transmission/mllp-mode.js';
import type { ConnectorMessage } from '../../base.js';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';
import { makeMockLogger, type MockLogger } from '../../__fixtures__/mock-logger.js';

const DEST_PORT = 16662;

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

    const second = await dispatcher.send(makeMessage({ messageId: 2 }), AbortSignal.timeout(5_000));
    expect(second.ok).toBe(true);
    expect(connectionCount).toBe(2);
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

describe('TcpMllpDispatcher while the remote refuses connections', () => {
  /** A quarter of this is the pause between connection attempts. */
  const ACQUIRE_MS = 400;

  /** A port nothing listens on. */
  async function closedPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    return port;
  }

  interface Remote {
    /** Stops accepting connections; the open ones keep working. */
    stopListening(): void;
    dropConnections(): Promise<void>;
  }

  async function listenOn(port: number): Promise<Remote> {
    const { server } = createMockServer(port);
    const connections = new Set<net.Socket>();
    server.on('connection', (socket) => { connections.add(socket); });
    await new Promise<void>((resolve) => { server.once('listening', resolve); });
    const closed = new Promise<void>((resolve) => { server.once('close', resolve); });
    const remote: Remote = {
      stopListening: () => { server.close(); },
      dropConnections: async () => {
        for (const socket of connections) socket.destroy();
        await closed;
      },
    };
    mockServer = { server, close: async () => { if (server.listening) remote.stopListening(); await remote.dropConnections(); } };
    return remote;
  }

  interface Started {
    readonly dispatcher: TcpMllpDispatcher;
    readonly log: MockLogger;
    send(signal?: AbortSignal): ReturnType<TcpMllpDispatcher['send']>;
  }

  async function startAgainst(port: number, overrides: Partial<TcpMllpDispatcherConfig> = {}): Promise<Started> {
    const log = makeMockLogger();
    const started = new TcpMllpDispatcher(makeConfig({ port, acquireTimeoutMs: ACQUIRE_MS, ...overrides }), log.logger);
    dispatcher = started;
    expect((await started.onStart()).ok).toBe(true);
    return { dispatcher: started, log, send: (signal) => started.send(makeMessage(), signal ?? new AbortController().signal) };
  }

  const outages = (log: MockLogger): number => log.errors.filter((e) => e.msg.includes('cannot be reached')).length;

  it('waits between connection attempts', async () => {
    let attempts = 0;
    const count = (): void => { attempts += 1; };
    const { send } = await startAgainst(await closedPort());
    diagnostics.subscribe('net.client.socket', count);
    try {
      expect((await send()).ok).toBe(false);
    } finally {
      diagnostics.unsubscribe('net.client.socket', count);
    }
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(attempts).toBeLessThanOrEqual(5);
  });

  it('fails with what it waited for and why it did not come', async () => {
    const port = await closedPort();
    const { send } = await startAgainst(port);
    const result = await send();
    expect(result.error?.message).toMatch(new RegExp(`^No connection to 127\\.0\\.0\\.1:${String(port)} within 400ms: .*ECONNREFUSED`));
  });

  it('gives the reason for a host with several addresses, in the error and the log', async () => {
    const { send, log } = await startAgainst(await closedPort(), { host: 'localhost' });
    const result = await send();
    expect(result.error?.message).toMatch(/within 400ms: .*ECONNREFUSED/);
    expect(log.errors[0]?.obj['errMsg']).toContain('ECONNREFUSED');
  });

  it('gives the reason when the send is aborted before its acquire timeout, as a queued one is', async () => {
    const port = await closedPort();
    const { send, log } = await startAgainst(port, { acquireTimeoutMs: 1_000 });
    const aborter = new AbortController();
    const sending = send(aborter.signal);
    await vi.waitFor(() => { expect(outages(log)).toBe(1); });
    aborter.abort();
    expect((await sending).error?.message).toMatch(new RegExp(`^Send aborted while 127\\.0\\.0\\.1:${String(port)} could not be reached: .*ECONNREFUSED`));
  });

  it('delivers a waiting message once the remote comes back', async () => {
    const port = await closedPort();
    const { send, log } = await startAgainst(port, { acquireTimeoutMs: 2_000 });
    const sending = send();
    await vi.waitFor(() => { expect(outages(log)).toBe(1); });
    await listenOn(port);
    const result = await sending;
    expect(result.ok && result.value.status).toBe('SENT');
  });

  it('tries again for a send that comes during the pause, however short its wait', async () => {
    const port = await closedPort();
    const { send } = await startAgainst(port, { acquireTimeoutMs: 200 });
    expect((await send()).ok).toBe(false);
    await listenOn(port);
    expect((await send()).ok).toBe(true);
  });

  it('logs an outage once, and the next outage again', async () => {
    const port = await closedPort();
    const { send, log } = await startAgainst(port);
    expect((await send()).ok).toBe(false);
    expect((await send()).ok).toBe(false);
    expect(outages(log)).toBe(1);

    const remote = await listenOn(port);
    expect((await send()).ok).toBe(true);
    remote.stopListening();
    await remote.dropConnections();

    // A send may still be given the pooled connection that just closed.
    await vi.waitFor(async () => {
      expect((await send()).ok).toBe(false);
      expect(outages(log)).toBe(2);
    }, { timeout: 5_000 });
  });

  it('logs an outage that follows a refused extra connection, once a send got through between them', async () => {
    const port = await closedPort();
    const { send, log } = await startAgainst(port, { acquireTimeoutMs: 1_000 });
    const remote = await listenOn(port);
    expect((await send()).ok).toBe(true);

    remote.stopListening();
    const both = await Promise.all([send(), send()]);
    expect(both.map((r) => r.ok)).toEqual([true, true]);
    await vi.waitFor(() => { expect(outages(log)).toBe(1); });
    expect((await send()).ok).toBe(true);

    await remote.dropConnections();
    await vi.waitFor(async () => {
      expect((await send()).ok).toBe(false);
      expect(outages(log)).toBe(2);
    }, { timeout: 5_000 });
  });

  it('takes a connection as reaching the remote, even when the send then fails', async () => {
    const port = await closedPort();
    const { send, log } = await startAgainst(port);
    expect((await send()).ok).toBe(false);

    const server = net.createServer((socket) => { socket.on('data', () => { socket.destroy(); }); });
    await new Promise<void>((resolve) => { server.listen(port, '127.0.0.1', resolve); });
    expect((await send()).ok).toBe(false);
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    expect(outages(log)).toBe(1);

    expect((await send()).ok).toBe(false);
    expect(outages(log)).toBe(2);
  });

  it('logs an outage again after a restart', async () => {
    const { send, log, dispatcher: started } = await startAgainst(await closedPort());
    expect((await send()).ok).toBe(false);
    expect((await started.onStop()).ok).toBe(true);
    expect((await started.onStart()).ok).toBe(true);
    expect((await send()).ok).toBe(false);
    expect(outages(log)).toBe(2);
  });
});
