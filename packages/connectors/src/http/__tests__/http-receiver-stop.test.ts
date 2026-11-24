import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';
import * as diagnostics from 'node:diagnostics_channel';
import { getEventListeners } from 'node:events';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import * as tls from 'node:tls';
import { Decompressor } from '../decompression.js';
import { HttpReceiver, type HttpReceiverConfig } from '../http-receiver.js';
import { readRequestBody, type RequestBody } from '../request-body.js';
import type { DispatchResult, RawMessage } from '../../base.js';
import type { Result } from '@galvanigraph/core-util';
import { freePort } from '../../__fixtures__/free-port.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';
import { withTimeout } from '../../timeout.js';

const PORT = await freePort();
const TLS = { cert: TEST_CERT_PEM, key: TEST_KEY_PEM };

const STOP_ARRIVAL_MS = 5_000;
const STOP_READ_MS = 15_000;
const LINGER_MS = 2_000;

let receiver: HttpReceiver | null = null;
const opened: net.Socket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await receiver?.onHalt();
  receiver = null;
  for (const socket of opened.splice(0)) socket.destroy();
});

/** Only the source's own timers are faked; Node's are not the global ones. */
function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

/** Not vi.waitFor, which moves faked timers on at each look and could fire the one a test is about. */
async function until(check: () => void): Promise<void> {
  const deadline = performance.now() + 10_000;
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (performance.now() > deadline) throw err;
    }
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

type Dispatch = (raw: RawMessage) => Promise<Result<DispatchResult>>;

const answered = (response: string): Result<DispatchResult> => ({ ok: true as const, value: { messageId: 1, response }, error: null });

async function start(config: Partial<HttpReceiverConfig> = {}, dispatch?: Dispatch): Promise<RawMessage[]> {
  const seen: RawMessage[] = [];
  receiver = new HttpReceiver({
    host: '127.0.0.1', port: PORT, path: '/', method: 'POST', responseContentType: 'text/plain', responseStatusCode: 200,
    errorStatusCode: 500, maxBodyBytes: 1024, bodyCharset: 'utf-8', ...config,
  }, makeMockLogger().logger);
  receiver.setDispatcher(async (raw) => {
    seen.push(raw);
    return dispatch ? dispatch(raw) : answered('ACK');
  });
  expect((await receiver.onStart()).ok).toBe(true);
  return seen;
}

/** A dispatcher that answers only when told to. */
function holding(response = 'ACK'): { readonly dispatch: Dispatch; readonly letGo: () => void } {
  let letGo = (): void => undefined;
  const gone = new Promise<void>((resolve) => { letGo = resolve; });
  return { dispatch: async () => { await gone; return answered(response); }, letGo };
}

interface Connection {
  readonly socket: net.Socket;
  /** All the server sent, once it has closed the connection. */
  readonly closed: Promise<string>;
  readonly received: () => string;
}

async function connect(sends: string): Promise<Connection> {
  const socket = net.connect(PORT, '127.0.0.1');
  opened.push(socket);
  let text = '';
  socket.on('data', (data: Buffer) => { text += data.toString('utf8'); });
  // A close follows every error.
  socket.on('error', () => undefined);
  const closed = new Promise<string>((resolve) => { socket.on('close', () => { resolve(text); }); });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  if (sends !== '') socket.write(sends);
  return { socket, closed, received: () => text };
}

/** Resolves once the receiver has seen everything written before: another connection's answer comes after it. */
async function settled(): Promise<void> {
  expect(await (await connect('GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).closed).toMatch(/^HTTP\/1\.1 405 /);
}

function settledOverTls(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: PORT, method: 'GET', rejectUnauthorized: false, agent: false }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.end();
  });
}

/** The requests the receiver was given, from the next one on. */
function watchRequests(): { readonly all: http.IncomingMessage[]; readonly end: () => void } {
  const all: http.IncomingMessage[] = [];
  const watch = (message: unknown): void => { all.push((message as { request: http.IncomingMessage }).request); };
  diagnostics.subscribe('http.server.request.start', watch);
  return { all, end: () => { diagnostics.unsubscribe('http.server.request.start', watch); } };
}

const head = (length: number): string => `POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${String(length)}\r\n\r\n`;

const LARGE = 4 * 1024 * 1024;
/** Windows takes two answers of any size off the server before the sender reads one. */
const MORE_THAN_IS_BUFFERED = `${head(1)}A`.repeat(4);

/** With no timer to move, so a stop that waits for anything fails here. */
async function stopsAtOnce(): Promise<void> {
  expect((await withTimeout(receiver!.onStop(), 2_000, 'HTTP source stop')).ok).toBe(true);
}

describe('HttpReceiver stop', () => {
  it('ends although a body stopped arriving, whose sender is told to send it again', async () => {
    fakeTimers();
    const seen = await start();
    const stalled = await connect(`${head(100)}MSH|`);
    await settled();

    const stopped = receiver!.onStop();
    await vi.advanceTimersByTimeAsync(STOP_ARRIVAL_MS);
    await until(() => { expect(stalled.received()).toMatch(/^HTTP\/1\.1 503 [\s\S]*\r\nConnection: close\r\n/i); });
    // Closed while its sender may still be sending, the connection would reset and take the answer with it.
    await delay(50);
    expect(stalled.socket.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(LINGER_MS);

    expect((await stopped).ok).toBe(true);
    await stalled.closed;
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no time for a body it has given up on to go over the limit', async () => {
    fakeTimers();
    const requests = watchRequests();
    try {
      await start({ maxBodyBytes: 1024 });
      const stalled = await connect(`${head(5_000)}MSH|`);
      await settled();
      const stopped = receiver!.onStop();
      await vi.advanceTimersByTimeAsync(STOP_ARRIVAL_MS);
      await until(() => { expect(stalled.received()).toMatch(/^HTTP\/1\.1 503 /); });
      const timers = vi.getTimerCount();

      let more = 0;
      requests.all[0]!.on('data', (chunk: Buffer) => { more += chunk.length; });
      stalled.socket.write('x'.repeat(2_000));
      await until(() => { expect(more).toBe(2_000); });

      expect(vi.getTimerCount()).toBe(timers);
      await vi.advanceTimersByTimeAsync(LINGER_MS);
      expect((await stopped).ok).toBe(true);
    } finally {
      requests.end();
    }
  });

  it('gives a body still arriving over the limit its 413', async () => {
    fakeTimers();
    const seen = await start({ maxBodyBytes: 4 });
    const large = await connect(`${head(100)}MSH|LAB`);
    await settled();

    const stopped = receiver!.onStop();
    await vi.advanceTimersByTimeAsync(STOP_ARRIVAL_MS);
    await until(() => { expect(large.received()).toMatch(/^HTTP\/1\.1 413 /); });
    await vi.advanceTimersByTimeAsync(LINGER_MS);

    expect((await stopped).ok).toBe(true);
    expect(seen).toEqual([]);
  });

  it('takes a body that arrives in time, and answers it', async () => {
    const seen = await start();
    const slow = await connect(`${head(7)}MSH`);
    await settled();

    const stopped = receiver!.onStop();
    slow.socket.write('|LAB');

    expect((await stopped).ok).toBe(true);
    expect(await slow.closed).toMatch(/^HTTP\/1\.1 200 [\s\S]*ACK/);
    expect(seen.map((raw) => raw.content)).toEqual(['MSH|LAB']);
  });

  it('answers what is in the pipeline, and says that the connection will close', async () => {
    const { dispatch, letGo } = holding();
    const seen = await start({}, dispatch);
    const kept = await connect(`${head(5)}first${head(6)}second`);
    await until(() => { expect(seen).toHaveLength(2); });

    const stopped = receiver!.onStop();
    letGo();

    expect((await stopped).ok).toBe(true);
    const answers = (await kept.closed).split('HTTP/1.1 200 OK').slice(1);
    expect(answers.map((answer) => /^Connection: (.*)$/im.exec(answer)?.[1])).toEqual(['keep-alive', 'close']);
  });

  it('answers 503 and closes the connection for a request that comes while it waits for another', async () => {
    const { dispatch, letGo } = holding();
    const seen = await start({}, dispatch);
    const working = await connect(`${head(5)}first`);
    const kept = await connect('');
    await until(() => { expect(seen).toHaveLength(1); });
    await settled();

    const stopped = receiver!.onStop();
    kept.socket.write(`${head(6)}second`);

    expect(await kept.closed).toMatch(/^HTTP\/1\.1 503 [\s\S]*\r\nConnection: close\r\n/i);
    letGo();
    expect((await stopped).ok).toBe(true);
    expect(await working.closed).toMatch(/^HTTP\/1\.1 200 /);
    expect(seen.map((raw) => raw.content)).toEqual(['first']);
  });

  it('closes a connection that was answered while it waits for another', async () => {
    fakeTimers();
    const held = new Map<string, () => void>();
    const seen = await start({}, async (raw) => {
      await new Promise<void>((resolve) => { held.set(raw.content, resolve); });
      return answered('ACK');
    });
    const early = await connect(`${head(5)}early`);
    const late = await connect(`${head(4)}late`);
    await until(() => { expect(seen).toHaveLength(2); });

    const stopped = receiver!.onStop();
    held.get('early')?.();
    await until(() => { expect(early.received()).toMatch(/^HTTP\/1\.1 200 /); });
    held.get('late')?.();

    expect(await Promise.race([Promise.all([stopped, early.closed, late.closed]).then(() => 'closed'), delay(3_000, 'left open')])).toBe('closed');
  });

  it('ends although a sender keeps sending on its connection', async () => {
    const seen = await start({}, async () => { await delay(20); return answered('ACK'); });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const send = (): Promise<number> => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', agent }, (res) => {
        res.resume();
        res.on('end', () => { resolve(res.statusCode ?? 0); });
      });
      req.on('error', () => { resolve(0); });
      req.end('MSH|LAB');
    });
    const statuses: number[] = [];
    let sending = true;
    const sender = (async (): Promise<void> => { while (sending) statuses.push(await send()); })();

    try {
      await until(() => { expect(seen.length).toBeGreaterThan(5); });
      await stopsAtOnce();
      const taken = seen.length;
      await until(() => { expect(statuses.at(-1)).toBe(0); });

      // Everything taken was answered, and nothing was taken after.
      expect(statuses.filter((status) => status === 200)).toHaveLength(taken);
      expect(seen).toHaveLength(taken);
    } finally {
      sending = false;
      agent.destroy();
      await sender;
    }
  });

  it.each([
    ['a connection that never sent anything', ''],
    ['half the headers of a request', 'POST / HTTP/1.1\r\nHost: localhost\r\nConte'],
  ])('does not wait for %s', async (_what, sends) => {
    const seen = await start();
    const connection = await connect(sends);
    await settled();

    await stopsAtOnce();

    expect(await connection.closed).toBe('');
    expect(seen).toEqual([]);
  });

  it.each([
    ['not begun', ''],
    ['half done', '\x16\x03\x01'],
  ])('ends although a TLS handshake is %s', async (_what, sends) => {
    await start({ tls: TLS });
    const connection = await connect(sends);
    await settledOverTls();

    await stopsAtOnce();

    expect(await connection.closed).toBe('');
  });

  it.each([
    ['HTTP', {}],
    ['HTTPS', { tls: TLS }],
  ])('delivers the whole of large %s answers to a sender slow to read them', async (_scheme, config) => {
    // The stop must not need its time to run out.
    fakeTimers();
    const { dispatch, letGo } = holding('Z'.repeat(LARGE));
    const seen = await start(config, dispatch);
    const address = { host: '127.0.0.1', port: PORT };
    const socket = 'tls' in config ? tls.connect({ ...address, rejectUnauthorized: false }) : net.connect(address);
    opened.push(socket);
    const answers: Buffer[] = [];
    socket.on('data', (data: Buffer) => { answers.push(data); });
    const closed = new Promise<void>((resolve, reject) => {
      socket.on('close', () => { resolve(); });
      socket.on('error', reject);
    });
    socket.write(MORE_THAN_IS_BUFFERED);
    await until(() => { expect(seen).toHaveLength(4); });
    socket.pause();

    const stopped = receiver!.onStop();
    letGo();
    // Long enough for the stop to have come to closing connections.
    await delay(100);
    socket.resume();

    await until(() => { expect(answers.reduce((sum, answer) => sum + answer.length, 0)).toBeGreaterThan(4 * LARGE); });
    // Well before Node would close a connection kept alive.
    expect(await Promise.race([closed.then(() => 'closed'), delay(3_000, 'left open')])).toBe('closed');
    expect(Buffer.concat(answers).filter((byte) => byte === 0x5a)).toHaveLength(4 * LARGE);
    expect((await stopped).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['HTTP', {}],
    ['HTTPS', { tls: TLS }],
  ])('cuts no %s answer short that was given before it and not read yet', async (_scheme, config) => {
    const held = new Map<string, () => void>();
    const seen = await start(config, async (raw) => {
      if (raw.content === 'L') await new Promise<void>((resolve) => { held.set('L', resolve); });
      return answered(raw.content === 'L' ? 'LAST' : 'Z'.repeat(LARGE));
    });
    const address = { host: '127.0.0.1', port: PORT };
    const socket = 'tls' in config ? tls.connect({ ...address, rejectUnauthorized: false }) : net.connect(address);
    opened.push(socket);
    const answers: Buffer[] = [];
    socket.on('data', (data: Buffer) => { answers.push(data); });
    const closed = new Promise<void>((resolve) => { socket.on('close', () => { resolve(); }); });
    socket.on('error', () => undefined);
    socket.write(`${MORE_THAN_IS_BUFFERED}${head(1)}L`);
    await until(() => { expect(seen).toHaveLength(5); });
    socket.pause();
    await delay(100);

    const stopped = receiver!.onStop();
    socket.resume();
    await delay(100);
    held.get('L')?.();

    expect((await stopped).ok).toBe(true);
    await closed;
    const all = Buffer.concat(answers);
    expect(all.filter((byte) => byte === 0x5a)).toHaveLength(4 * LARGE);
    expect(all.subarray(-20).toString()).toContain('LAST');
  });

  it('closes a connection once the answers given before it have been read', async () => {
    const seen = await start({}, async () => answered('Z'.repeat(LARGE)));
    const reader = await connect('');
    reader.socket.write(MORE_THAN_IS_BUFFERED);
    reader.socket.pause();
    await until(() => { expect(seen).toHaveLength(4); });
    await delay(100);

    const stopped = receiver!.onStop();
    reader.socket.resume();

    // Before Node would close a connection kept alive.
    expect(await Promise.race([Promise.all([stopped, reader.closed]).then(() => 'closed'), delay(2_500, 'left open')])).toBe('closed');
  });

  it('ends although a sender does not read its answers', async () => {
    fakeTimers();
    const { dispatch, letGo } = holding('Z'.repeat(LARGE));
    const seen = await start({}, dispatch);
    const deaf = await connect('');
    deaf.socket.pause();
    deaf.socket.write(MORE_THAN_IS_BUFFERED);
    await until(() => { expect(seen).toHaveLength(4); });

    let ended = false;
    const stopped = receiver!.onStop().then(() => { ended = true; });
    letGo();
    await until(() => { expect(vi.getTimerCount()).toBe(1); });
    await delay(50);
    await vi.advanceTimersByTimeAsync(STOP_READ_MS - 1);
    await delay(50);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await stopped;
  });

  it('ends at a halt, although a message is stuck in the pipeline', async () => {
    const { dispatch, letGo } = holding();
    const seen = await start({}, dispatch);
    await connect(`${head(5)}first`);
    await until(() => { expect(seen).toHaveLength(1); });

    const stopped = receiver!.onStop();
    await receiver!.onHalt();

    expect((await withTimeout(stopped, 2_000, 'Stop after a halt')).ok).toBe(true);
    letGo();
  });

  it('keeps nothing of the connections and requests that are done', async () => {
    const seen = await start();
    for (let i = 0; i < 3; i++) await (await connect(`${head(3)}MSH`)).socket.end();
    await until(() => { expect(seen).toHaveLength(3); });
    const { listener } = receiver as unknown as { readonly listener: { readonly connections: Set<unknown>; readonly inProgress: Set<unknown> } };

    await until(() => { expect([listener.connections.size, listener.inProgress.size]).toEqual([0, 0]); });
  });

  it('stops the running source after another start could not listen', async () => {
    await start();
    expect((await receiver!.onStart()).error?.message).toContain('EADDRINUSE');

    await stopsAtOnce();

    await expect(connect('')).rejects.toThrow('ECONNREFUSED');
  });

  it('that a halt overtook leaves the next start alone', async () => {
    const { dispatch, letGo } = holding();
    const seen = await start({}, dispatch);
    await connect(`${head(5)}first`);
    await until(() => { expect(seen).toHaveLength(1); });

    const stopped = receiver!.onStop();
    await receiver!.onHalt();
    expect((await receiver!.onStart()).ok).toBe(true);
    letGo();
    expect((await stopped).ok).toBe(true);

    // Still the receiver's own to stop: a lost listener would keep the port.
    await settled();
    await stopsAtOnce();
    await expect(connect('')).rejects.toThrow('ECONNREFUSED');
  });
});

describe('HttpReceiver halt', () => {
  it('closes a connection whose TLS handshake is not done', async () => {
    await start({ tls: TLS });
    const connection = await connect('');
    await settledOverTls();

    expect((await receiver!.onHalt()).ok).toBe(true);

    expect(await withTimeout(connection.closed, 2_000, 'connection close')).toBe('');
  });

  it.each([
    ['HTTP', {}],
    ['HTTPS', { tls: TLS }],
  ])('has closed every %s request by the time it returns', async (_scheme, config) => {
    const { dispatch, letGo } = holding();
    const requests = watchRequests();
    try {
      const seen = await start(config, dispatch);
      const options = { host: '127.0.0.1', port: PORT, method: 'POST', rejectUnauthorized: false, agent: false } as const;
      const req = 'tls' in config ? https.request(options) : http.request(options);
      const broken = new Promise((resolve) => { req.on('error', resolve); });
      req.end('MSH|LAB');
      await until(() => { expect(seen).toHaveLength(1); });

      const halted = receiver!.onHalt();
      // What tells a body still being decompressed not to be dispatched, so it may not come a moment later.
      expect(requests.all.map((request) => request.socket.destroyed)).toEqual([true]);
      await halted;
      await broken;
      letGo();
    } finally {
      requests.end();
    }
  });
});

describe('readRequestBody', () => {
  const CONFIG = { maxBodyBytes: 16, bodyCharset: 'utf-8' } as const;

  function arriving(signal: AbortSignal): { readonly sender: PassThrough; readonly body: Promise<RequestBody> } {
    const sender = Object.assign(new PassThrough(), { headers: {} });
    const body = readRequestBody({ req: sender as unknown as http.IncomingMessage, arrivalEnded: signal }, CONFIG, new Decompressor(16));
    return { sender, body };
  }

  it.each([
    ['has arrived', (sender: PassThrough): void => { sender.end('MSH'); }, 'MSH'],
    ['is over the limit', (sender: PassThrough): void => { sender.end('x'.repeat(17)); }, 'Payload Too Large'],
    ['was broken off', (sender: PassThrough): void => { sender.destroy(new Error('aborted')); }, 'aborted'],
  ])('leaves nothing on the stop signal once a body %s', async (_what, finish, outcome) => {
    const stop = new AbortController();
    const { sender, body } = arriving(stop.signal);
    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(1);

    finish(sender);

    expect(await body.then((read) => read.text, (err: Error) => err.message)).toBe(outcome);
    expect(getEventListeners(stop.signal, 'abort')).toEqual([]);
  });

  it('gives up at once on a body that starts to arrive after the stop has waited long enough', async () => {
    const { body } = arriving(AbortSignal.abort());

    await expect(body).rejects.toMatchObject({ status: 503, stillArriving: true });
  });
});

describe('HttpReceiver after a body over the limit that keeps arriving', () => {
  const DRAIN_MS = 10_000;

  it('takes nothing more from that connection', async () => {
    fakeTimers();
    const seen = await start({ maxBodyBytes: 4 });
    const large = await connect(`${head(20)}MSH|LAB`);
    await until(() => { expect(vi.getTimerCount()).toBe(1); });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await until(() => { expect(large.received()).toMatch(/^HTTP\/1\.1 413 /); });

    // The rest of the body, and a message behind it that can never be answered.
    large.socket.write(`${'x'.repeat(13)}${head(3)}ADT`);
    await settled();
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    await large.closed;

    expect(seen).toEqual([]);
  });

  it('does not lose the 413 to what the sender has pipelined behind that body', async () => {
    fakeTimers();
    const requests = watchRequests();
    onTestFinished(requests.end);
    await start({ maxBodyBytes: 4 });
    const large = await connect(`${head(20)}MSH|LAB`);
    await until(() => { expect(vi.getTimerCount()).toBe(1); });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await until(() => { expect(large.received()).toMatch(/^HTTP\/1\.1 413 /); });

    large.socket.write(`${'x'.repeat(13)}${head(LARGE)}`);
    await until(() => { expect(requests.all).toHaveLength(2); });
    large.socket.write('A'.repeat(LARGE));

    // Read to its end, though nothing is done with it: what is unread when the connection closes resets it.
    await until(() => { expect(requests.all[1]?.complete).toBe(true); });
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    await large.closed;
  });

  it.each([
    ['has ended', (socket: net.Socket): void => { socket.write('x'.repeat(13)); }],
    ['was broken off', (socket: net.Socket): void => { socket.destroy(); }],
  ])('keeps no timer once the body %s', async (_what, finish) => {
    fakeTimers();
    await start({ maxBodyBytes: 4 });
    const large = await connect(`${head(20)}MSH|LAB`);
    await until(() => { expect(vi.getTimerCount()).toBe(1); });

    finish(large.socket);

    await until(() => { expect(vi.getTimerCount()).toBe(0); });
  });

  it('keeps no timer once the sender has its answer and leaves', async () => {
    fakeTimers();
    await start({ maxBodyBytes: 4 });
    const large = await connect(`${head(20)}MSH|LAB`);
    await until(() => { expect(vi.getTimerCount()).toBe(1); });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await until(() => { expect(large.received()).toMatch(/^HTTP\/1\.1 413 /); });
    expect(vi.getTimerCount()).toBe(1);

    large.socket.destroy();

    await until(() => { expect(vi.getTimerCount()).toBe(0); });
  });
});
