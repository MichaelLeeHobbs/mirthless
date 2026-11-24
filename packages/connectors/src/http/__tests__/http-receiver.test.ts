import { describe, it, expect, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import * as zlib from 'node:zlib';
import {
  HttpReceiver,
  DEFAULT_MAX_BODY_BYTES,
  type HttpReceiverConfig,
} from '../http-receiver.js';
import type { RawMessage, DispatchResult } from '../../base.js';
import { stderr, type Result } from '@galvanigraph/core-util';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';
import { makeMockLogger, type MockLogger } from '../../__fixtures__/mock-logger.js';
import { withTimeout } from '../../timeout.js';

const TEST_PORT = 18661;

/** Holds the source's gunzip calls while closed, so a test can act while bodies are being decompressed. */
const gunzipGate = vi.hoisted(() => ({ closed: false, held: [] as (() => void)[], started: 0, running: 0, mostRunning: 0 }));

vi.mock('node:zlib', async (importOriginal) => {
  const original = await importOriginal<typeof zlib>();
  const gunzip = (bytes: zlib.InputType, options: zlib.ZlibOptions, callback: zlib.CompressCallback): void => {
    gunzipGate.started += 1;
    gunzipGate.running += 1;
    gunzipGate.mostRunning = Math.max(gunzipGate.mostRunning, gunzipGate.running);
    const go = (): void => {
      original.gunzip(bytes, options, (err, result) => {
        gunzipGate.running -= 1;
        callback(err, result);
      });
    };
    if (gunzipGate.closed) gunzipGate.held.push(go);
    else go();
  };
  return { ...original, gunzip };
});

function closeGunzipGate(): void {
  Object.assign(gunzipGate, { closed: true, held: [], started: 0, running: 0, mostRunning: 0 });
}

function openGunzipGate(): void {
  gunzipGate.closed = false;
  for (const go of gunzipGate.held.splice(0)) go();
}

/** Lets what is held finish, and everything that follows from it in the source run. */
async function finishGunzip(): Promise<void> {
  openGunzipGate();
  await vi.waitFor(() => { expect(gunzipGate.running).toBe(0); });
  await new Promise((resolve) => { setImmediate(resolve); });
}

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
    bodyCharset: 'utf-8',
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

function failingDispatcher(): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async () => ({ ok: false as const, value: null, error: stderr('pipeline down') });
}

async function sendRequest(
  port: number,
  options: {
    method?: string;
    path?: string;
    body?: string | Uint8Array;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const { method = 'POST', path = '/', body, headers = {} } = options;
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method,
    ...(body !== undefined ? { body } : {}),
    // Fresh connection per request: a pooled keep-alive socket from a previous
    // test's (now stopped) server on the same port would otherwise be reused.
    headers: { connection: 'close', ...headers },
    signal: AbortSignal.timeout(5_000),
  });

  const responseBody = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return { status: response.status, body: responseBody, headers: responseHeaders };
}

interface PostResult {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  /** The client's own port, which tells a reused connection from a new one. */
  readonly port: number | undefined;
}

/** Without an agent the request asks for `Connection: close`. */
function post(body: Buffer, headers: Record<string, string>, agent?: http.Agent): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const connection: Record<string, string> = agent ? {} : { connection: 'close' };
    const req = http.request({ host: '127.0.0.1', port: TEST_PORT, method: 'POST', headers: { ...connection, ...headers }, ...(agent ? { agent } : {}) }, (res) => {
      const port = req.socket?.localPort;
      res.resume();
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, port }); });
    });
    req.setTimeout(5_000, () => { req.destroy(new Error('no answer')); });
    req.on('error', reject);
    req.end(body);
  });
}

let receiver: HttpReceiver | null = null;

afterEach(async () => {
  openGunzipGate();
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

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

  it.each([
    [{ type: 'BASIC' }],
    [{ type: 'BASIC', username: 'svc' }],
    [{ type: 'BASIC', password: 'p' }],
    [{ type: 'TOKEN' }],
    [{ type: 'TOKEN', token: '' }],
  ] as const)('refuses to deploy auth %j, which would accept empty credentials or nothing', async (auth) => {
    receiver = new HttpReceiver(makeConfig({ auth }));
    const result = await receiver.onDeploy();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/auth/);
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

    receiver = null;
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

  it('keeps credentials out of the stored source map', async () => {
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
      headers: {
        Authorization: 'Bearer s3cret-token', 'Proxy-Authorization': 'Basic dTpw', Cookie: 'session=abc',
        'X-Api-Key': 'key-123', 'X-Custom': 'foo',
      },
    });

    const headers = capturedRaw!.sourceMap['headers'] as Record<string, string>;
    expect(headers['authorization']).toBe('[redacted]');
    expect(headers['proxy-authorization']).toBe('[redacted]');
    expect(headers['cookie']).toBe('[redacted]');
    expect(headers['x-api-key']).toBe('[redacted]');
    expect(headers['x-custom']).toBe('foo');
    expect(JSON.stringify(capturedRaw!.sourceMap)).not.toMatch(/s3cret-token|dTpw|session=abc|key-123/);
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

  it('keeps a query parameter named __proto__', async () => {
    const seen: RawMessage[] = [];
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => { seen.push(raw); return { messageId: 1, response: 'OK' }; }));
    await receiver.onStart();

    await sendRequest(TEST_PORT, { path: '/?__proto__=x&foo=bar', body: '' });

    expect(seen.map((raw) => Object.entries(raw.sourceMap['queryString'] as object))).toEqual([[['__proto__', 'x'], ['foo', 'bar']]]);
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

    receiver = null;
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

describe('HttpReceiver paths', () => {
  async function start(config: Partial<HttpReceiverConfig>, seen: string[]): Promise<void> {
    receiver = new HttpReceiver(makeConfig(config));
    receiver.setDispatcher(makeDispatcher((raw) => {
      seen.push(String(raw.sourceMap['contextPath']));
      return { messageId: 1, response: 'OK' };
    }));
    await receiver.onDeploy();
    await receiver.onStart();
  }

  it('takes only its own path by default', async () => {
    const seen: string[] = [];
    await start({ path: '/api' }, seen);

    expect((await sendRequest(TEST_PORT, { path: '/api', body: 'a' })).status).toBe(200);
    expect((await sendRequest(TEST_PORT, { path: '/api/report', body: 'b' })).status).toBe(404);
    expect(seen).toEqual(['/api']);
  });

  it('with matchSubpaths takes every path below its own and reports it as contextPath', async () => {
    const seen: string[] = [];
    await start({ path: '/api', matchSubpaths: true }, seen);

    expect((await sendRequest(TEST_PORT, { path: '/api/report?x=1', body: 'a' })).status).toBe(200);
    expect((await sendRequest(TEST_PORT, { path: '/apix', body: 'b' })).status).toBe(404);
    expect(seen).toEqual(['/api/report']);
  });

  it('with matchSubpaths at the root takes every path', async () => {
    const seen: string[] = [];
    await start({ path: '/', matchSubpaths: true }, seen);

    expect((await sendRequest(TEST_PORT, { path: '/api/study', body: 'a' })).status).toBe(200);
    expect(seen).toEqual(['/api/study']);
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

describe('HttpReceiver reports the pipeline outcome', () => {
  it('returns the error status when the pipeline recorded the message with an error', async () => {
    receiver = new HttpReceiver(makeConfig({ errorStatusCode: 502 }));
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 7, status: 'ERROR', response: 'partial' })));
    await receiver.onStart();

    const res = await sendRequest(TEST_PORT, { body: 'msg' });

    expect(res.status).toBe(502);
    expect(res.body).toBe('');
  });

  it('returns the success status for a filtered message', async () => {
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 7, status: 'FILTERED' })));
    await receiver.onStart();

    const res = await sendRequest(TEST_PORT, { body: 'msg' });

    expect(res.status).toBe(200);
  });
});

describe('HttpReceiver request character set', () => {
  it('decodes the body in the charset the Content-Type declares', async () => {
    const seen: string[] = [];
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => { seen.push(raw.content); return { messageId: 1 }; }));
    await receiver.onStart();

    const res = await sendRequest(TEST_PORT, {
      body: Buffer.from('PID|1||Müller', 'latin1'),
      headers: { 'content-type': 'text/plain; charset=ISO-8859-1' },
    });

    expect(res.status).toBe(200);
    expect(seen).toEqual(['PID|1||Müller']);
  });

  it('reads UTF-8 when no charset is declared', async () => {
    const seen: string[] = [];
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => { seen.push(raw.content); return { messageId: 1 }; }));
    await receiver.onStart();

    await sendRequest(TEST_PORT, { body: 'PID|1||Müller', headers: { 'content-type': 'application/hl7-v2' } });

    expect(seen).toEqual(['PID|1||Müller']);
  });

  it('answers 415 and dispatches nothing for a charset it cannot decode', async () => {
    let dispatched = 0;
    receiver = new HttpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher(() => { dispatched++; return { messageId: 1 }; }));
    await receiver.onStart();

    const res = await sendRequest(TEST_PORT, { body: 'x', headers: { 'content-type': 'text/plain; charset=klingon' } });

    expect(res.status).toBe(415);
    expect(dispatched).toBe(0);
  });
});

/** Records every dispatched message, so a test can also show that nothing was. */
async function startRecording(config?: Partial<HttpReceiverConfig>): Promise<{ readonly seen: RawMessage[]; readonly log: MockLogger }> {
  const seen: RawMessage[] = [];
  const log = makeMockLogger();
  receiver = new HttpReceiver(makeConfig(config), log.logger);
  receiver.setDispatcher(makeDispatcher((raw) => { seen.push(raw); return { messageId: 1, response: 'ACK' }; }));
  expect((await receiver.onDeploy()).ok).toBe(true);
  expect((await receiver.onStart()).ok).toBe(true);
  return { seen, log };
}

const HL7 = 'MSH|^~\\&|LAB|HOSP|EHR|HOSP|20261123||ORU^R01|1|P|2.5\rPID|1||123||Müller^Jörg\r';
const EVERY_BYTE = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte));
/** The comment after a PDF's header has four bytes over 0x7F, which are not UTF-8. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from('\n1 0 obj\n')]);

const CODINGS = [
  ['gzip', zlib.gzipSync],
  ['x-gzip', zlib.gzipSync],
  ['deflate', zlib.deflateSync],
  ['br', zlib.brotliCompressSync],
] as const;

describe('HttpReceiver compressed bodies', () => {
  it.each(CODINGS)('reads a %s body as the text that was compressed', async (coding, compress) => {
    const { seen } = await startRecording();

    const res = await sendRequest(TEST_PORT, { body: compress(HL7), headers: { 'content-encoding': coding } });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content)).toEqual([HL7]);
  });

  it.each(CODINGS)('keeps every byte of a binary %s body with base64', async (coding, compress) => {
    const { seen } = await startRecording({ bodyCharset: 'base64' });

    const res = await sendRequest(TEST_PORT, { body: compress(EVERY_BYTE), headers: { 'content-encoding': coding } });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content)).toEqual([EVERY_BYTE.toString('base64')]);
  });

  it('reads a gzip body of several members as all of them', async () => {
    const { seen } = await startRecording();

    const body = Buffer.concat([zlib.gzipSync('MSH|1\r'), zlib.gzipSync('PID|1\r')]);
    const res = await sendRequest(TEST_PORT, { body, headers: { 'content-encoding': 'gzip' } });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content)).toEqual(['MSH|1\rPID|1\r']);
  });

  it('reads the coding in any case, and decodes the decompressed text in its declared charset', async () => {
    const { seen } = await startRecording();

    const res = await sendRequest(TEST_PORT, {
      body: zlib.gzipSync(Buffer.from('PID|1||Müller', 'latin1')),
      headers: { 'content-encoding': 'GZIP', 'content-type': 'text/plain; charset=ISO-8859-1' },
    });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content)).toEqual(['PID|1||Müller']);
  });

  it('reads an identity body as sent', async () => {
    const { seen } = await startRecording();

    const res = await sendRequest(TEST_PORT, { body: HL7, headers: { 'content-encoding': 'identity' } });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content)).toEqual([HL7]);
  });

  // `constructor` is a property every object has, so a plain-object lookup would find a coding by that name.
  it.each(['zstd', 'compress', 'gzip, gzip', 'gzip, br', 'identity, gzip', 'constructor'])('refuses Content-Encoding %s and names the codings it takes', async (coding) => {
    const { seen, log } = await startRecording();

    const res = await sendRequest(TEST_PORT, { body: zlib.gzipSync(HL7), headers: { 'content-encoding': coding, 'content-type': 'text/plain' } });

    expect(res.status).toBe(415);
    expect(res.headers['accept-encoding']).toBe('gzip, deflate, br');
    expect(seen).toEqual([]);
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]?.obj).toMatchObject({ remoteAddress: '127.0.0.1', contentType: 'text/plain' });
  });

  it('refuses two Content-Encoding headers as two codings', async () => {
    const { seen } = await startRecording();

    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: TEST_PORT, method: 'POST', headers: { connection: 'close' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.setHeader('content-encoding', ['gzip', 'br']);
      req.on('error', reject);
      req.end(zlib.gzipSync(HL7));
    });

    expect(status).toBe(415);
    expect(seen).toEqual([]);
  });

  it.each(CODINGS)('refuses a truncated %s body', async (coding, compress) => {
    const { seen, log } = await startRecording();
    const whole = compress(HL7);

    const res = await sendRequest(TEST_PORT, { body: whole.subarray(0, whole.length - 4), headers: { 'content-encoding': coding } });

    expect(res.status).toBe(400);
    expect(res.body).toContain(coding);
    expect(seen).toEqual([]);
    expect(log.warnings).toHaveLength(1);
  });

  it.each(CODINGS)('refuses a body that is not the %s it claims to be', async (coding) => {
    const { seen } = await startRecording();

    const res = await sendRequest(TEST_PORT, { body: HL7, headers: { 'content-encoding': coding } });

    expect(res.status).toBe(400);
    expect(seen).toEqual([]);
  });

  // zlib and brotli stop at the end of the stream without an error, which would drop the second message.
  it.each(CODINGS.filter(([coding]) => !coding.includes('gzip')))('refuses bytes after the end of a %s body instead of dropping them', async (coding, compress) => {
    const { seen } = await startRecording();

    const res = await sendRequest(TEST_PORT, { body: Buffer.concat([compress('MSH|1\r'), compress('MSH|2\r')]), headers: { 'content-encoding': coding } });

    expect(res.status).toBe(400);
    expect(seen).toEqual([]);
  });

  it.each(CODINGS)('refuses a small %s body that decompresses past maxBodyBytes', async (coding, compress) => {
    const { seen } = await startRecording({ maxBodyBytes: 16 * 1024 });
    const bomb = compress(Buffer.alloc(1024 * 1024, 0x41));
    expect(bomb.length).toBeLessThan(16 * 1024);

    const res = await sendRequest(TEST_PORT, { body: bomb, headers: { 'content-encoding': coding } });

    expect(res.status).toBe(413);
    expect(seen).toEqual([]);
  });

  it('limits the bytes received as well as the decompressed size', async () => {
    const { seen } = await startRecording({ maxBodyBytes: 16 });
    const body = zlib.gzipSync('x'.repeat(16));
    expect(body.length).toBeGreaterThan(16);

    const res = await sendRequest(TEST_PORT, { body, headers: { 'content-encoding': 'gzip' } });

    expect(res.status).toBe(413);
    expect(seen).toEqual([]);
  });

  it('accepts a body that decompresses to exactly maxBodyBytes', async () => {
    const { seen } = await startRecording({ maxBodyBytes: 4096 });

    const res = await sendRequest(TEST_PORT, { body: zlib.gzipSync('x'.repeat(4096)), headers: { 'content-encoding': 'gzip' } });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content.length)).toEqual([4096]);
  });
});

describe('HttpReceiver limits what compressed bodies can hold', () => {
  const LIMIT = 64 * 1024;
  const GZIP = { 'content-encoding': 'gzip' };
  /** Under a hundred bytes that decompress to exactly the limit. */
  const FULL = zlib.brotliCompressSync(Buffer.alloc(LIMIT, 0x41));
  const BR = { 'content-encoding': 'br' };

  /** A dispatcher that answers only when told to, so the messages it holds stay unanswered. */
  async function startHolding(config: Partial<HttpReceiverConfig>): Promise<{ readonly held: number[]; readonly letGo: () => void }> {
    const held: number[] = [];
    let letGo = (): void => undefined;
    const gone = new Promise<void>((resolve) => { letGo = resolve; });
    receiver = new HttpReceiver(makeConfig(config));
    receiver.setDispatcher(async (raw) => {
      held.push(raw.content.length);
      await gone;
      return { ok: true as const, value: { messageId: 1 }, error: null };
    });
    expect((await receiver.onStart()).ok).toBe(true);
    return { held, letGo };
  }

  it('answers 503 with Retry-After once unanswered bodies fill four times maxBodyBytes, and takes bodies again after', async () => {
    const { held, letGo } = await startHolding({ maxBodyBytes: LIMIT });
    expect(FULL.length).toBeLessThan(100);
    const refused: PostResult[] = [];
    const answers = Array.from({ length: 12 }, () => post(FULL, BR).then((answer) => {
      if (answer.status === 503) refused.push(answer);
      return answer.status;
    }));

    await vi.waitFor(() => { expect(refused.length + held.length).toBe(12); });
    expect(held).toEqual([LIMIT, LIMIT, LIMIT, LIMIT]);
    expect(refused.every((answer) => answer.headers['retry-after'] === '1')).toBe(true);

    letGo();
    expect((await Promise.all(answers)).sort()).toEqual([...Array<number>(4).fill(200), ...Array<number>(8).fill(503)]);
    expect((await post(FULL, BR)).status).toBe(200);
  });

  it('answers 503, not 413, to a body that would fit but for the ones already held, and takes a smaller one', async () => {
    const { held, letGo } = await startHolding({ maxBodyBytes: LIMIT });
    const half = zlib.gzipSync(Buffer.alloc(LIMIT / 2, 0x41));
    const answers = [post(FULL, BR), post(FULL, BR), post(FULL, BR), post(half, GZIP)];
    await vi.waitFor(() => { expect(held).toHaveLength(4); });

    expect((await post(FULL, BR)).status).toBe(503);
    answers.push(post(half, GZIP));
    await vi.waitFor(() => { expect(held).toHaveLength(5); });

    letGo();
    expect((await Promise.all(answers)).map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200]);
  });

  it('answers 413 to every one of a burst of bombs, and holds nothing for them after', async () => {
    const { seen } = await startRecording({ maxBodyBytes: LIMIT });
    const bomb = zlib.brotliCompressSync(Buffer.alloc(LIMIT * 16, 0x41));

    const statuses = await Promise.all(Array.from({ length: 12 }, () => post(bomb, BR).then((answer) => answer.status)));

    expect(statuses).toEqual(Array<number>(12).fill(413));
    expect(seen).toEqual([]);
    expect((await post(FULL, BR)).status).toBe(200);
  });

  it('decompresses at most two bodies at once, and then the rest', async () => {
    const { seen } = await startRecording();
    closeGunzipGate();
    const answers = Array.from({ length: 6 }, (_, i) => post(zlib.gzipSync(`MSH|${String(i)}`), GZIP));
    await vi.waitFor(() => { expect(gunzipGate.started).toBe(2); });

    await finishGunzip();

    expect((await Promise.all(answers)).map((answer) => answer.status)).toEqual(Array<number>(6).fill(200));
    expect(gunzipGate.mostRunning).toBe(2);
    expect(seen.map((raw) => raw.content).sort()).toEqual(['MSH|0', 'MSH|1', 'MSH|2', 'MSH|3', 'MSH|4', 'MSH|5']);
  });

  it('answers 200 to fifty small gzip messages held at once', async () => {
    const { held, letGo } = await startHolding({});
    const answers = Array.from({ length: 50 }, () => post(zlib.gzipSync(HL7), GZIP).then((answer) => answer.status));

    await vi.waitFor(() => { expect(held).toHaveLength(50); }, { timeout: 10_000 });
    letGo();

    expect(await Promise.all(answers)).toEqual(Array<number>(50).fill(200));
  });

  it.each([
    ['a body that is not valid text', 415, undefined],
    ['a dispatcher that throws', 500, (): never => { throw new Error('pipeline gone'); }],
  ])('holds nothing after %s', async (_what, status, dispatcher) => {
    await startRecording({ maxBodyBytes: LIMIT });
    if (dispatcher) receiver!.setDispatcher(dispatcher);
    const body = zlib.gzipSync(Buffer.alloc(LIMIT, dispatcher ? 0x41 : 0xff));

    // Four would fill the limit if any were kept.
    for (let i = 0; i < 6; i++) expect((await post(body, GZIP)).status).toBe(status);
  });

  it('holds nothing after a halt while bodies were being decompressed or waited their turn', async () => {
    await startRecording({ maxBodyBytes: LIMIT });
    const body = zlib.gzipSync(Buffer.alloc(LIMIT, 0x41));
    for (let i = 0; i < 3; i++) {
      closeGunzipGate();
      const answers = Promise.allSettled(Array.from({ length: 4 }, () => post(body, GZIP)));
      await vi.waitFor(() => { expect(gunzipGate.started).toBe(2); });
      await receiver!.onHalt();
      await answers;
      await finishGunzip();
      // The two that waited were not decompressed for nobody.
      expect(gunzipGate.started).toBe(2);
      expect((await receiver!.onStart()).ok).toBe(true);
    }

    expect((await post(body, GZIP)).status).toBe(200);
  });

  it('holds nothing after a sender goes away while its message is being processed', async () => {
    const { held, letGo } = await startHolding({ maxBodyBytes: LIMIT });
    for (let i = 1; i <= 4; i++) {
      const socket = net.connect(TEST_PORT, '127.0.0.1', () => {
        socket.write(`POST / HTTP/1.1\r\nHost: localhost\r\nContent-Encoding: br\r\nContent-Length: ${String(FULL.length)}\r\n\r\n`);
        socket.write(FULL);
      });
      await vi.waitFor(() => { expect(held).toHaveLength(i); });
      socket.destroy();
    }
    // Still in the pipeline, so still held.
    expect((await post(FULL, BR)).status).toBe(503);

    letGo();
    await vi.waitFor(async () => { expect((await post(FULL, BR)).status).toBe(200); });
  });
});

describe('HttpReceiver refusals reach the sender', () => {
  const LARGE = Buffer.alloc(20 * 1024 * 1024, 0x41);

  it.each([
    ['an unknown coding', { 'content-encoding': 'zstd' }, {}, 415],
    ['an unknown charset', { 'content-type': 'text/plain; charset=klingon' }, {}, 415],
    ['a body over the limit', {}, { maxBodyBytes: 1024 }, 413],
  ] as const)('answers %s with a large body on a connection that closes', async (_what, headers, config, status) => {
    const { seen } = await startRecording(config);

    expect((await post(LARGE, headers)).status).toBe(status);
    expect(seen).toEqual([]);
  });

  it.each([
    ['an unknown coding', { 'content-encoding': 'zstd' }, {}, 415],
    ['a body over the limit', {}, { maxBodyBytes: 1024 }, 413],
  ] as const)('takes the next message on the connection after %s, and a stop does not wait for it', async (_what, headers, config, status) => {
    const { seen } = await startRecording(config);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    try {
      const refused = await post(LARGE, headers, agent);
      const accepted = await post(Buffer.from(HL7), {}, agent);
      expect([refused.status, accepted.status]).toEqual([status, 200]);
      expect(accepted.port).toBe(refused.port);
      expect(seen.map((raw) => raw.content)).toEqual([HL7]);
      await withTimeout(receiver!.onStop(), 2_000, 'HTTP source stop');
    } finally {
      agent.destroy();
    }
  });
});

describe('HttpReceiver bodies that are not valid in their charset', () => {
  it('refuses a PDF, says how to accept it, and dispatches nothing', async () => {
    const { seen, log } = await startRecording();

    const res = await sendRequest(TEST_PORT, { body: PDF, headers: { 'content-type': 'application/pdf' } });

    expect(res.status).toBe(415);
    expect(res.body).toContain('utf-8');
    expect(res.body).toContain('Content-Type');
    expect(res.body).toContain('bodyCharset');
    expect(res.headers['accept-encoding']).toBeUndefined();
    expect(seen).toEqual([]);
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]?.obj).toMatchObject({ remoteAddress: '127.0.0.1', contentType: 'application/pdf' });
  });

  it('never logs the body it refuses', async () => {
    const { log } = await startRecording();

    await sendRequest(TEST_PORT, { body: Buffer.from('PID|1||123||Müller', 'latin1') });

    expect(log.warnings).toHaveLength(1);
    expect(JSON.stringify([log.warnings, log.errors])).not.toMatch(/PID|123|ller/);
  });

  it.each([undefined, 'application/pdf', 'text/plain; charset=utf-8', 'text/plain; charset=klingon'])('keeps the same PDF with base64 under Content-Type %s', async (contentType) => {
    const { seen } = await startRecording({ bodyCharset: 'base64' });

    const res = await sendRequest(TEST_PORT, { body: PDF, ...(contentType ? { headers: { 'content-type': contentType } } : {}) });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => Buffer.from(raw.content, 'base64').equals(PDF))).toEqual([true]);
  });

  it('refuses Latin-1 text that declares no charset', async () => {
    const { seen } = await startRecording();

    const res = await sendRequest(TEST_PORT, { body: Buffer.from('PID|1||Müller', 'latin1'), headers: { 'content-type': 'text/plain' } });

    expect(res.status).toBe(415);
    expect(seen).toEqual([]);
  });

  it.each([
    ['latin1', Buffer.from('PID|1||Müller', 'latin1'), 'PID|1||Müller'],
    ['windows-1252', Buffer.from([0x93, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x94]), '\u201cMüller\u201d'],
  ] as const)('reads text that declares no charset in bodyCharset %s', async (bodyCharset, body, text) => {
    const { seen } = await startRecording({ bodyCharset });

    const res = await sendRequest(TEST_PORT, { body, headers: { 'content-type': 'text/plain' } });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content)).toEqual([text]);
  });

  it('reads a declared charset over bodyCharset', async () => {
    const { seen } = await startRecording({ bodyCharset: 'latin1' });

    const res = await sendRequest(TEST_PORT, { body: 'PID|1||Müller', headers: { 'content-type': 'text/plain; charset=utf-8' } });

    expect(res.status).toBe(200);
    expect(seen.map((raw) => raw.content)).toEqual(['PID|1||Müller']);
  });

  it.each([
    ['utf-8', Buffer.from('PID|1||Müller', 'latin1')],
    ['shift_jis', Buffer.from([0x41, 0x81])],
    ['utf-16le', Buffer.from([0x41, 0x00, 0x42])],
  ])('refuses a body that is not valid in the %s it declares, whatever bodyCharset says', async (declared, body) => {
    const { seen } = await startRecording({ bodyCharset: 'latin1' });

    const res = await sendRequest(TEST_PORT, { body, headers: { 'content-type': `text/plain; charset=${declared}` } });

    expect(res.status).toBe(415);
    expect(res.body).toContain(declared);
    expect(seen).toEqual([]);
  });

  it('keeps a byte order mark, declared charset or not', async () => {
    const { seen } = await startRecording();
    const text = '\ufeffMSH|1';

    await sendRequest(TEST_PORT, { body: Buffer.from(text), headers: { 'content-type': 'text/plain; charset=utf-8' } });
    await sendRequest(TEST_PORT, { body: Buffer.from(text) });

    expect(seen.map((raw) => raw.content)).toEqual([text, text]);
  });
});

/**
 * Sends a request no HTTP client would build, and resolves with all the server sent once it
 * closes the connection. `afterContinue` gives the body to send when the server answers 100 Continue.
 */
function sendRaw(head: string | Buffer, afterContinue?: () => Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    let answer = '';
    let continued = false;
    const socket = net.connect(TEST_PORT, '127.0.0.1', () => { socket.write(head); });
    socket.setTimeout(3_000, () => {
      reject(new Error(`no answer, got "${answer}"`));
      socket.destroy();
    });
    socket.on('data', (chunk: Buffer) => {
      answer += chunk.toString('utf8');
      if (continued || !afterContinue || !answer.includes('100 Continue')) return;
      continued = true;
      afterContinue().then((body) => { socket.write(body); }, reject);
    });
    // A close follows every error.
    socket.on('error', () => undefined);
    socket.on('close', () => { resolve(answer); });
  });
}

const rawPost = (target: string, host: string): string => `POST ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nContent-Length: 2\r\n\r\nhi`;

describe('HttpReceiver request target', () => {
  it.each(['a b', '[', ''])('takes a request whose Host header is %j, query included', async (host) => {
    const { seen } = await startRecording();

    expect(await sendRaw(rawPost('/?site=east', host))).toMatch(/^HTTP\/1\.1 200 /);
    expect(seen.map((raw) => [raw.content, raw.sourceMap['queryString']])).toEqual([['hi', { site: 'east' }]]);
  });

  it('takes the target // as a path below / with matchSubpaths, and refuses it without', async () => {
    const { seen } = await startRecording({ matchSubpaths: true });

    expect(await sendRaw(rawPost('//?a=1', 'localhost'))).toMatch(/^HTTP\/1\.1 200 /);
    expect(seen.map((raw) => [raw.sourceMap['path'], raw.sourceMap['queryString']])).toEqual([['//', { a: '1' }]]);
    await receiver?.onStop();

    const exact = await startRecording();
    expect(await sendRaw(rawPost('//?a=1', 'localhost'))).toMatch(/^HTTP\/1\.1 404 /);
    expect(exact.seen).toEqual([]);
  });

  it('decodes the query and keeps the last value of a repeated parameter', async () => {
    const { seen } = await startRecording();

    await sendRequest(TEST_PORT, { path: '/?name=M%C3%BCller+J&site=a&site=b&raw=x?y', body: 'x' });

    expect(seen.map((raw) => raw.sourceMap['queryString'])).toEqual([{ name: 'Müller J', site: 'b', raw: 'x?y' }]);
  });
});

describe('HttpReceiver stopped while a body is being decompressed', () => {
  const GZIP = { 'content-encoding': 'gzip' };

  it.each([
    ['halted', async (): Promise<void> => { await receiver?.onHalt(); }],
    ['halted and undeployed', async (): Promise<void> => {
      await receiver?.onHalt();
      await receiver?.onUndeploy();
    }],
  ])('dispatches nothing once %s', async (_what, stop) => {
    const { seen, log } = await startRecording();
    closeGunzipGate();
    const answer = post(zlib.gzipSync(HL7), GZIP);
    await vi.waitFor(() => { expect(gunzipGate.started).toBe(1); });

    await stop();
    await expect(answer).rejects.toThrow();
    await finishGunzip();

    expect(seen).toEqual([]);
    expect(log.warnings.map((w) => w.obj)).toEqual([{ remoteAddress: '127.0.0.1' }]);
  });

  it('dispatches nothing for a sender whose connection closed, who will send it again', async () => {
    const { seen } = await startRecording();
    closeGunzipGate();
    const body = zlib.gzipSync(HL7);
    const socket = net.connect(TEST_PORT, '127.0.0.1', () => {
      socket.write(`POST / HTTP/1.1\r\nHost: localhost\r\nContent-Encoding: gzip\r\nContent-Length: ${String(body.length)}\r\n\r\n`);
      socket.write(body);
    });
    await vi.waitFor(() => { expect(gunzipGate.started).toBe(1); });

    socket.destroy();
    // The server has seen the close once a stop has nothing left to wait for.
    await withTimeout(receiver!.onStop(), 2_000, 'HTTP source stop');
    await finishGunzip();

    expect(seen).toEqual([]);
  });

  it('a stop waits for the message and answers it', async () => {
    const { seen } = await startRecording();
    closeGunzipGate();
    const answer = post(zlib.gzipSync(HL7), GZIP);
    await vi.waitFor(() => { expect(gunzipGate.started).toBe(1); });

    const stopped = receiver!.onStop();
    await finishGunzip();

    expect((await answer).status).toBe(200);
    expect((await stopped).ok).toBe(true);
    expect(seen.map((raw) => raw.content)).toEqual([HL7]);
  });
});

describe('HttpReceiver transfer codings', () => {
  const chunked = (body: Buffer, coding: string): string => [
    'POST / HTTP/1.1', 'Host: localhost', 'Connection: close', `Transfer-Encoding: ${coding}`, '',
    body.length.toString(16), body.toString('latin1'), '0', '', '',
  ].join('\r\n');

  it.each(['chunked', 'Chunked'])('takes a body sent %s', async (coding) => {
    const { seen } = await startRecording();

    expect(await sendRaw(Buffer.from(chunked(Buffer.from(HL7), coding), 'latin1'))).toMatch(/^HTTP\/1\.1 200 /);
    expect(seen.map((raw) => raw.content)).toEqual([HL7]);
  });

  // Node takes only the chunked off, so the body is still compressed when the source reads it.
  it.each(['gzip, chunked', 'identity, chunked'])('answers 501 to Transfer-Encoding %s', async (coding) => {
    const { seen } = await startRecording({ bodyCharset: 'base64' });

    expect(await sendRaw(Buffer.from(chunked(zlib.gzipSync(HL7), coding), 'latin1'))).toMatch(/^HTTP\/1\.1 501 /);
    expect(seen).toEqual([]);
  });
});

describe('HttpReceiver answers every request', () => {
  it.each([
    ['rejects', (): Promise<never> => Promise.reject(new Error('pipeline gone'))],
    ['throws', (): never => { throw new Error('pipeline gone'); }],
  ])('answers the error status when the dispatcher %s, and logs why without the body', async (_how, dispatcher) => {
    const log = makeMockLogger();
    receiver = new HttpReceiver(makeConfig({ errorStatusCode: 502 }), log.logger);
    receiver.setDispatcher(dispatcher);
    await receiver.onStart();

    const res = await sendRequest(TEST_PORT, { body: 'PID|1||Doe' });

    expect(res.status).toBe(502);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]?.obj).toMatchObject({ errMsg: 'pipeline gone', remoteAddress: '127.0.0.1' });
    expect(JSON.stringify(log.errors)).not.toContain('Doe');
  });

  it('closes the connection when the answer fails after its headers were written', async () => {
    const log = makeMockLogger();
    receiver = new HttpReceiver(makeConfig(), log.logger);
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1, response: 42 as unknown as string })));
    await receiver.onStart();

    expect(await sendRaw(rawPost('/', 'localhost'))).toBe('');
    expect(log.errors).toHaveLength(1);
  });

  it('answers 503 to a request whose body was still arriving when the channel was undeployed', async () => {
    const { seen } = await startRecording();

    const head = 'POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n';
    const answer = await sendRaw(head, async () => {
      await receiver?.onUndeploy();
      return 'hello';
    });

    expect(answer).toContain('HTTP/1.1 503 ');
    expect(seen).toEqual([]);
  });

  it('answers 503 to a request that arrives after the channel was undeployed', async () => {
    const { seen } = await startRecording();
    await receiver?.onUndeploy();

    const res = await sendRequest(TEST_PORT, { body: 'late' });

    expect(res.status).toBe(503);
    expect(seen).toEqual([]);
  });
});
