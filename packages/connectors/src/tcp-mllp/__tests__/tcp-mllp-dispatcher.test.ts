import { describe, it, expect, vi, afterEach } from 'vitest';
import * as diagnostics from 'node:diagnostics_channel';
import dns from 'node:dns';
import { getEventListeners } from 'node:events';
import * as net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import * as tls from 'node:tls';
import { TcpMllpDispatcher, type TcpMllpDispatcherConfig } from '../tcp-mllp-dispatcher.js';
import { wrapMllp, MllpParser } from '../../transmission/mllp-mode.js';
import type { ConnectorMessage } from '../../base.js';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';
import { makeMockLogger, type MockLogger } from '../../__fixtures__/mock-logger.js';
import { withTimeout } from '../../timeout.js';
import { freePort } from '../../__fixtures__/free-port.js';

const DEST_PORT = await freePort();

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

  it('connects and sends nothing when the charset cannot hold the message (#415)', async () => {
    let connections = 0;
    mockServer = createMockServer(DEST_PORT);
    mockServer.server.on('connection', () => { connections += 1; });
    await new Promise<void>((resolve) => {
      mockServer!.server.once('listening', resolve);
    });
    dispatcher = new TcpMllpDispatcher(makeConfig({ charset: 'latin1' }));
    await dispatcher.onStart();

    // Node would write U+010D as 0x0D, the end of an HL7 segment.
    const result = await dispatcher.send(makeMessage({ content: 'PID|1||DO\u010dEK' }), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('The text holds the character U+010D, which the charset latin1 does not have');
    const next = await dispatcher.send(makeMessage({ content: 'PID|1||DO\u00dfEK' }), AbortSignal.timeout(5_000));
    expect(next.value?.status).toBe('SENT');
    expect(connections).toBe(1);
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
    silentServer.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => {
      silentServer.once('listening', resolve);
    });

    dispatcher = new TcpMllpDispatcher(makeConfig({ port: (silentServer.address() as net.AddressInfo).port, responseTimeout: 30_000 }));
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
    const { send } = await startAgainst(await freePort());
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
    const port = await freePort();
    const { send } = await startAgainst(port);
    const result = await send();
    expect(result.error?.message).toMatch(new RegExp(`^No connection to 127\\.0\\.0\\.1:${String(port)} within 400ms: .*ECONNREFUSED`));
  });

  it('gives each address\'s reason for a host with several, in the error and the log', async () => {
    const addresses = [{ address: '127.0.0.1', family: 4 }, { address: '127.0.0.2', family: 4 }];
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(((_host: string, _options: unknown, done: (err: null, found: unknown) => void) => {
      done(null, addresses);
    }) as unknown as typeof dns.lookup);
    try {
      const port = await freePort();
      const { send, log, dispatcher: started } = await startAgainst(port, { host: 'partner.example', acquireTimeoutMs: 5_000 });
      const aborter = new AbortController();
      const sending = send(aborter.signal);
      await vi.waitFor(() => { expect(outages(log)).toBe(1); }, { timeout: 4_000 });
      aborter.abort();
      const refused = new RegExp(`127\\.0\\.0\\.1:${String(port)}.*; .*127\\.0\\.0\\.2:${String(port)}`);
      expect((await sending).error?.message).toMatch(refused);
      expect(log.errors[0]?.obj['errMsg']).toMatch(refused);
      // The aborted send keeps its place in the pool, so let it have a connection or the stop waits for it.
      await listenOn(port);
      expect((await started.onStop()).ok).toBe(true);
    } finally {
      lookup.mockRestore();
    }
  });

  it('gives the reason when the send is aborted before its acquire timeout, as a queued one is', async () => {
    const port = await freePort();
    const { send, log } = await startAgainst(port, { acquireTimeoutMs: 5_000 });
    const aborter = new AbortController();
    const sending = send(aborter.signal);
    await vi.waitFor(() => { expect(outages(log)).toBe(1); }, { timeout: 4_000 });
    aborter.abort();
    expect((await sending).error?.message).toMatch(new RegExp(`^Send aborted while 127\\.0\\.0\\.1:${String(port)} could not be reached: .*ECONNREFUSED`));
    await listenOn(port);
  });

  it('delivers a waiting message once the remote comes back, within seconds however long it may wait', async () => {
    const port = await freePort();
    const { send, log } = await startAgainst(port, { acquireTimeoutMs: 30_000 });
    const sending = send();
    await vi.waitFor(() => { expect(outages(log)).toBe(1); }, { timeout: 4_000 });
    await listenOn(port);
    const back = performance.now();
    const result = await sending;
    expect(result.ok && result.value.status).toBe('SENT');
    expect(performance.now() - back).toBeLessThan(6_000);
  });

  it('tries again for a send that comes during the pause, however short its wait', async () => {
    const port = await freePort();
    const { send, log } = await startAgainst(port);
    const aborter = new AbortController();
    const first = send(aborter.signal);
    await vi.waitFor(() => { expect(outages(log)).toBe(1); });
    aborter.abort();
    expect((await first).ok).toBe(false);
    await listenOn(port);
    expect((await send()).ok).toBe(true);
  });

  it('logs an outage once, and the next outage again', async () => {
    const port = await freePort();
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

  it('does not take a refused extra connection for an outage, and logs the outage that follows', async () => {
    const port = await freePort();
    const { send, log } = await startAgainst(port, { acquireTimeoutMs: 1_000 });
    const remote = await listenOn(port);
    expect((await send()).ok).toBe(true);

    remote.stopListening();
    let attempts = 0;
    const count = (): void => { attempts += 1; };
    diagnostics.subscribe('net.client.socket', count);
    try {
      const both = await Promise.all([send(), send()]);
      expect(both.map((r) => r.ok)).toEqual([true, true]);
    } finally {
      diagnostics.unsubscribe('net.client.socket', count);
    }
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(outages(log)).toBe(0);

    await remote.dropConnections();
    await vi.waitFor(async () => {
      expect((await send()).ok).toBe(false);
      expect(outages(log)).toBe(1);
    }, { timeout: 5_000 });
  });

  it('says no connection was free when the remote is up and all are busy', async () => {
    const silent = net.createServer();
    await new Promise<void>((resolve) => { silent.listen(0, '127.0.0.1', resolve); });
    const { port } = silent.address() as net.AddressInfo;
    const sockets: net.Socket[] = [];
    silent.on('connection', (socket) => { sockets.push(socket); });
    const { send } = await startAgainst(port, { maxConnections: 1 });
    const first = send();
    await vi.waitFor(() => { expect(sockets).toHaveLength(1); });
    expect((await send()).error?.message).toBe(`No free connection to 127.0.0.1:${String(port)} within 400ms`);
    for (const socket of sockets) socket.destroy();
    expect((await first).ok).toBe(false);
    await new Promise<void>((resolve) => { silent.close(() => { resolve(); }); });
  });

  it('keeps the pool\'s own error for a send during a stop', async () => {
    const { send, dispatcher: started } = await startAgainst(await freePort());
    const stopping = started.onStop();
    expect((await send()).error?.message).toContain('draining');
    expect((await stopping).ok).toBe(true);
  });

  it('takes a connection as reaching the remote, even when the send then fails', async () => {
    const port = await freePort();
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

  describe('and is halted', () => {
    /** What a halt took before: the longest a send may wait. */
    const LONG_WAIT = { acquireTimeoutMs: 20_000 };

    /** With nothing to wait for it ends before any timer can fire, however busy the machine. */
    async function halt(started: TcpMllpDispatcher): Promise<void> {
      expect(await Promise.race([started.onHalt().then((result) => result.ok), delay(100, 'still waiting')])).toBe(true);
    }

    /** Takes connections and what is sent on them, and answers nothing. */
    async function silentRemote(): Promise<{ readonly port: number; readonly sockets: net.Socket[]; readonly received: () => number }> {
      const sockets: net.Socket[] = [];
      let bytes = 0;
      const server = net.createServer((socket) => {
        sockets.push(socket);
        socket.on('data', (chunk: Buffer) => { bytes += chunk.length; });
        socket.on('error', () => undefined);
      });
      await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      mockServer = { server, close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }) };
      return { port: (server.address() as net.AddressInfo).port, sockets, received: () => bytes };
    }

    it('ends at once, with every send that waits, whoever asked for it', async () => {
      const { send, log, dispatcher: started } = await startAgainst(await freePort(), { ...LONG_WAIT, maxConnections: 2 });
      const waiting = [send(), send(), send(), send()];
      await vi.waitFor(() => { expect(outages(log)).toBe(1); });

      await halt(started);

      expect((await Promise.all(waiting)).map((result) => result.ok)).toEqual([false, false, false, false]);
      expect((await send()).error?.message).toBe('Dispatcher not started');
    });

    it('makes no connection after it', async () => {
      const { send, log, dispatcher: started } = await startAgainst(await freePort());
      const waiting = send();
      await vi.waitFor(() => { expect(outages(log)).toBe(1); });
      await halt(started);
      let attempts = 0;
      const count = (): void => { attempts += 1; };
      diagnostics.subscribe('net.client.socket', count);
      try {
        // Two pauses between attempts, within the time the send had to wait.
        await delay(ACQUIRE_MS / 2);
      } finally {
        diagnostics.unsubscribe('net.client.socket', count);
      }
      expect((await waiting).ok).toBe(false);
      expect(attempts).toBe(0);
    });

    it('gives up a connect in progress, which is no outage', async () => {
      const port = await freePort();
      const connecting: net.Socket[] = [];
      const watch = (message: unknown): void => { connecting.push((message as { socket: net.Socket }).socket); };
      diagnostics.subscribe('net.client.socket', watch);
      const lookup = vi.spyOn(dns, 'lookup').mockImplementation((() => undefined) as unknown as typeof dns.lookup);
      try {
        const { send, log, dispatcher: started } = await startAgainst(port, { ...LONG_WAIT, host: 'partner.example' });
        const waiting = send();
        await vi.waitFor(() => { expect(lookup).toHaveBeenCalled(); });

        await halt(started);

        expect((await waiting).ok).toBe(false);
        expect(log.errors).toEqual([]);
        expect(connecting.map((socket) => socket.destroyed)).toEqual([true]);
      } finally {
        lookup.mockRestore();
        diagnostics.unsubscribe('net.client.socket', watch);
      }
    });

    it('leaves nothing on its signal for a connect that succeeded or failed', async () => {
      const added = vi.spyOn(EventTarget.prototype, 'addEventListener');
      try {
        const { port, sockets } = await silentRemote();
        const taken = await startAgainst(port, LONG_WAIT);
        const sending = taken.send();
        await vi.waitFor(() => { expect(sockets).toHaveLength(1); });
        sockets[0]?.write(wrapMllp(ackFrame('AA')));
        expect((await sending).ok).toBe(true);
        expect((await taken.dispatcher.onStop()).ok).toBe(true);
        const refused = await startAgainst(await freePort());
        expect((await refused.send()).ok).toBe(false);
        // Which also waits for a connect that is being tried now.
        expect((await refused.dispatcher.onStop()).ok).toBe(true);

        const signals = added.mock.calls.flatMap(([, listener], i) =>
          (typeof listener === 'function' && listener.name === 'onHalt' ? [added.mock.contexts[i] as EventTarget] : []));
        expect(signals.length).toBeGreaterThanOrEqual(2);
        for (const signal of signals) expect(getEventListeners(signal, 'abort')).toEqual([]);
      } finally {
        added.mockRestore();
      }
    });

    it('ends a send that waits for its acknowledgement, and closes its connection', async () => {
      const { port, sockets, received } = await silentRemote();
      const { send, dispatcher: started } = await startAgainst(port, { ...LONG_WAIT, maxConnections: 1, responseTimeout: 20_000 });
      const sending = send();
      const behind = send();
      await vi.waitFor(() => { expect(received()).toBeGreaterThan(0); });
      const closed = new Promise<void>((resolve) => { sockets[0]?.once('close', () => { resolve(); }); });
      const once = received();

      await halt(started);

      expect((await Promise.all([sending, behind])).map((result) => result.ok)).toEqual([false, false]);
      await withTimeout(closed, 2_000, 'Connection close');
      expect(received()).toBe(once);
      expect(sockets).toHaveLength(1);
    });

    it('closes a connection no send is using', async () => {
      const { port, sockets } = await silentRemote();
      const { send, dispatcher: started } = await startAgainst(port, LONG_WAIT);
      const sending = send();
      await vi.waitFor(() => { expect(sockets).toHaveLength(1); });
      sockets[0]?.write(wrapMllp(ackFrame('AA')));
      expect((await sending).ok).toBe(true);
      const closed = new Promise<void>((resolve) => { sockets[0]?.once('close', () => { resolve(); }); });

      await halt(started);

      await withTimeout(closed, 2_000, 'Connection close');
    });

    it('sends nothing when it comes between the connection and the send', async () => {
      const { port, sockets, received } = await silentRemote();
      const { send, dispatcher: started } = await startAgainst(port, { ...LONG_WAIT, responseTimeout: 20_000 });
      const original = EventTarget.prototype.removeEventListener;
      const aborter = new AbortController();
      const spy = vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (this: EventTarget, ...args: Parameters<EventTarget['removeEventListener']>): void {
        original.apply(this, args);
        // The send has its socket, and goes on a few microtasks from here.
        if (typeof args[1] === 'function' && args[1].name === 'onAbort') queueMicrotask(() => { aborter.abort(); });
      });
      try {
        const result = await withTimeout(send(aborter.signal), 2_000, 'Send');
        expect(result.error?.message).toBe('Send aborted');
      } finally {
        spy.mockRestore();
      }
      await vi.waitFor(() => { expect(sockets[0]?.destroyed || sockets[0]?.readableEnded).toBe(true); });
      expect(received()).toBe(0);
      await halt(started);
    });

    it('ends a stop in progress, which leaves the next start alone', async () => {
      const port = await freePort();
      const { send, log, dispatcher: started } = await startAgainst(port, LONG_WAIT);
      const waiting = send();
      await vi.waitFor(() => { expect(outages(log)).toBe(1); });
      const stopped = started.onStop();
      const halted = started.onHalt();
      expect((await started.onStart()).ok).toBe(true);

      expect((await withTimeout(Promise.all([stopped, halted]), 2_000, 'Stop and halt')).map((result) => result.ok)).toEqual([true, true]);
      expect((await waiting).ok).toBe(false);
      await listenOn(port);
      expect((await send()).ok).toBe(true);
    });
  });

  it('logs an outage again after a restart', async () => {
    const { send, log, dispatcher: started } = await startAgainst(await freePort());
    expect((await send()).ok).toBe(false);
    expect((await started.onStop()).ok).toBe(true);
    expect((await started.onStart()).ok).toBe(true);
    expect((await send()).ok).toBe(false);
    expect(outages(log)).toBe(2);
  });
});
