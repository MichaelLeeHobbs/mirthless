// A server that signs a client in and does not start SFTP: no connection may be left open (#434).

import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SftpReceiver, SFTP_POST_ACTION } from '../sftp-receiver.js';
import { SftpDispatcher } from '../sftp-dispatcher.js';
import { createSsh2SftpClient } from '../sftp-client.js';
import { startSftpServer, type TestSftpServer } from '../../__fixtures__/sftp-server.js';

let server: TestSftpServer;

beforeEach(async () => {
  server = await startSftpServer('/in', '/out');
});

afterEach(async () => {
  vi.useRealTimers();
  await server.close();
});

/** Resolves once a signed-in client has asked for SFTP, which it never gets. */
function leaveUnanswered(): Promise<void> {
  return new Promise((resolve) => { server.rules.onSubsystem = () => { resolve(); }; });
}

async function expectNoConnections(): Promise<void> {
  await vi.waitFor(() => { expect(server.connections()).toBe(0); }, { timeout: 5_000 });
}

/** In front of the server: passes data on, and never closes its side towards the client. */
async function startRelay(): Promise<{ readonly port: number; readonly client: Promise<Socket>; close(): Promise<void> }> {
  const sockets: Socket[] = [];
  let onClient: (socket: Socket) => void = () => undefined;
  /** The first. */
  const client = new Promise<Socket>((resolve) => { onClient = resolve; });
  const relay = createServer({ allowHalfOpen: true }, (socket) => {
    const upstream = connect({ port: server.options.port, host: '127.0.0.1', allowHalfOpen: true });
    sockets.push(socket, upstream);
    for (const s of [socket, upstream]) s.on('error', () => { /* A reset by the client is what the test waits for. */ });
    socket.on('data', (data) => upstream.write(data));
    upstream.on('data', (data) => { if (socket.writable) socket.write(data); });
    onClient(socket);
  });
  await new Promise<void>((resolve) => { relay.listen(0, '127.0.0.1', resolve); });
  return {
    port: (relay.address() as AddressInfo).port,
    client,
    close: async (): Promise<void> => {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => { relay.close(resolve); });
    },
  };
}

function makeSource(port = server.options.port, seen: string[] = []): SftpReceiver {
  const receiver = new SftpReceiver({
    ...server.options,
    port,
    remoteDirectory: '/in',
    filePattern: '*',
    pollingIntervalMs: 100,
    afterProcessing: SFTP_POST_ACTION.NONE,
    moveToDirectory: '',
    minFileAgeMs: 0,
    ignoreDot: true,
  });
  receiver.setDispatcher(async (raw) => {
    seen.push(raw.content);
    return { ok: true as const, value: { messageId: 1 }, error: null };
  });
  return receiver;
}

async function send(signal: AbortSignal, port = server.options.port): Promise<string> {
  const dispatcher = new SftpDispatcher({
    ...server.options, port, remoteDirectory: '/out', fileNameTemplate: 'a.hl7', appendMode: false, tempFileEnabled: true,
  });
  expect((await dispatcher.onStart()).ok).toBe(true);
  const result = await dispatcher.send({ channelId: 'ch-1', messageId: 42, metaDataId: 1, content: 'A', dataType: 'HL7V2' }, signal);
  return result.ok ? 'sent' : result.error.message;
}

describe('an SFTP server that signs in and never answers the request for SFTP', () => {
  it('has no connection left once the client is closed', async () => {
    const asked = leaveUnanswered();
    const client = createSsh2SftpClient(server.options);
    const connecting = client.connect().catch((err: unknown) => err);
    await asked;
    expect(server.connections()).toBe(1);

    await client.end();

    await expectNoConnections();
    expect(await connecting).toBeInstanceOf(Error);
  });

  it('closes our socket even when the server never closes its side', async () => {
    const asked = leaveUnanswered();
    const relay = await startRelay();
    try {
      const client = createSsh2SftpClient({ ...server.options, port: relay.port });
      const connecting = client.connect().catch((err: unknown) => err);
      const socket = await relay.client;
      await asked;

      await client.end();

      // A socket that is only half closed still takes data; one that is gone answers it with a reset.
      await vi.waitFor(() => {
        if (!socket.destroyed) socket.write('x');
        expect(socket.destroyed).toBe(true);
      }, { timeout: 5_000 });
      expect(await connecting).toBeInstanceOf(Error);
    } finally {
      await relay.close();
    }
  });

  it('has no connection left when a source gives up its connect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const asked = leaveUnanswered();
    const starting = makeSource().onStart();
    await asked;
    expect(server.connections()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    const started = await starting;
    vi.useRealTimers();

    expect(started.ok ? '' : started.error.message).toBe('SFTP connect timed out after 30000ms');
    await expectNoConnections();
  });

  it('has no connection left when a send is given up', async () => {
    const asked = leaveUnanswered();
    const abort = new AbortController();
    const sending = send(abort.signal);
    await asked;
    expect(server.connections()).toBe(1);

    abort.abort(new Error('SFTP send given up by the test'));

    expect(await sending).toContain('given up by the test');
    await expectNoConnections();
  });
});

/** A socket that is only half closed still takes data; one that is gone answers it with a reset. */
async function expectGone(socket: Socket): Promise<void> {
  await vi.waitFor(() => {
    if (!socket.destroyed) socket.write('x');
    expect(socket.destroyed).toBe(true);
  }, { timeout: 5_000 });
}

describe('an SFTP server that does not answer a request or the close (#413)', () => {
  let relay: Awaited<ReturnType<typeof startRelay>>;

  beforeEach(async () => {
    relay = await startRelay();
  });

  afterEach(async () => {
    await relay.close();
  });

  it('a send ends when it is given up, and its connection is gone', async () => {
    let reached = (): void => undefined;
    const asked = new Promise<void>((resolve) => { reached = resolve; });
    server.rules.unanswered = () => { reached(); return true; };
    const abort = new AbortController();
    const sending = send(abort.signal, relay.port);
    await asked;

    const before = Date.now();
    abort.abort(new Error('SFTP send given up by the test'));

    expect(await sending).toContain('given up by the test');
    // The temporary file is asked after for 2 seconds only when there is one.
    expect(Date.now() - before).toBeLessThan(1_500);
    await expectGone(await relay.client);
  });

  it('a send that went through is SENT, and its connection is gone', async () => {
    const before = Date.now();
    expect(await send(new AbortController().signal, relay.port)).toBe('sent');
    expect(Date.now() - before).toBeLessThan(6_000);
    await expectGone(await relay.client);
  });

  it('a halt of a source ends at once, its connection is gone, and the next start polls', async () => {
    let reached = (): void => undefined;
    const asked = new Promise<void>((resolve) => { reached = resolve; });
    server.put('/in/a.hl7', 'A');
    const seen: string[] = [];
    const source = makeSource(relay.port, seen);
    expect((await source.onStart()).ok).toBe(true);
    server.rules.unanswered = (request) => { if (request === 'OPENDIR') reached(); return true; };
    await asked;

    const before = Date.now();
    expect((await source.onHalt()).ok).toBe(true);
    expect(Date.now() - before).toBeLessThan(1_000);
    await expectGone(await relay.client);

    delete server.rules.unanswered;
    expect((await source.onStart()).ok).toBe(true);
    await vi.waitFor(() => { expect(seen).toContain('A'); }, { timeout: 5_000 });
    await source.onHalt();
  });

  it.each(['onHalt', 'onStop'] as const)('%s ends a connect of the poll cycle, and the next start polls', async (action) => {
    server.put('/in/a.hl7', 'A');
    const seen: string[] = [];
    const source = makeSource(server.options.port, seen);
    expect((await source.onStart()).ok).toBe(true);
    // The connection is lost, and the server signs the next one in and leaves it there.
    const asked = leaveUnanswered();
    await server.dropClients();
    await asked;

    const before = Date.now();
    expect((await source[action]()).ok).toBe(true);
    expect(Date.now() - before).toBeLessThan(1_500);
    await expectNoConnections();

    delete server.rules.onSubsystem;
    seen.length = 0;
    expect((await source.onStart()).ok).toBe(true);
    await vi.waitFor(() => { expect(seen).toContain('A'); }, { timeout: 5_000 });
    await source.onHalt();
  });

  it('a stop of a source ends, and its connection is gone', async () => {
    const source = makeSource(relay.port);
    expect((await source.onStart()).ok).toBe(true);

    const before = Date.now();
    expect((await source.onStop()).ok).toBe(true);
    expect(Date.now() - before).toBeLessThan(5_000);
    await expectGone(await relay.client);
  });

  it('a refused host key leaves no connection', async () => {
    const client = createSsh2SftpClient({ ...server.options, port: relay.port, hostKey: 'another' });
    await expect(client.connect()).rejects.toThrow();
    await client.end();
    await expectGone(await relay.client);
  });
});

describe('a halt of an SFTP source while a stop waits for its file', () => {
  it('ends the stop', async () => {
    server.put('/in/a.hl7', 'A');
    let reached = (): void => undefined;
    const taken = new Promise<void>((resolve) => { reached = resolve; });
    let letGo = (): void => undefined;
    const held = new Promise<void>((resolve) => { letGo = resolve; });
    const source = makeSource();
    source.setDispatcher(async () => {
      reached();
      await held;
      return { ok: true as const, value: { messageId: 1 }, error: null };
    });
    await source.onStart();
    await taken;

    const stopping = source.onStop();
    await source.onHalt();
    expect((await stopping).ok).toBe(true);
    expect(server.connections()).toBe(1);
    letGo();
    await expectNoConnections();
  });

  it('is of that start only: a stop of the next one waits for its file', async () => {
    const source = makeSource();
    await source.onStart();
    await source.onHalt();
    let reached = (): void => undefined;
    const taken = new Promise<void>((resolve) => { reached = resolve; });
    let letGo = (): void => undefined;
    const held = new Promise<void>((resolve) => { letGo = resolve; });
    source.setDispatcher(async () => {
      reached();
      await held;
      return { ok: true as const, value: { messageId: 1 }, error: null };
    });
    await source.onStart();
    server.put('/in/a.hl7', 'A');
    await taken;

    let stopped = false;
    const stopping = source.onStop().then(() => { stopped = true; });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(stopped).toBe(false);
    letGo();
    await stopping;
    await expectNoConnections();
  });
});

describe('an SFTP server that signs in and refuses to start SFTP', () => {
  beforeEach(() => {
    server.rules.onSubsystem = (refuse) => { refuse(); };
  });

  it('has no connection left when a source cannot start', async () => {
    const started = await makeSource().onStart();
    expect(started.ok ? '' : started.error.message).toContain('Unable to start subsystem: sftp');
    await expectNoConnections();
  });

  it('has no connection left when a send fails', async () => {
    expect(await send(new AbortController().signal)).toContain('Unable to start subsystem: sftp');
    await expectNoConnections();
  });
});
