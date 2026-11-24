import { describe, it, expect, afterEach } from 'vitest';
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

const TEST_PORT = 18661;

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

let receiver: HttpReceiver | null = null;

afterEach(async () => {
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

  it('answers a refused coding and then takes the next message on the same connection', async () => {
    const { seen } = await startRecording();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const post = (body: Buffer, headers: Record<string, string>): Promise<{ status: number; port: number | undefined }> => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: TEST_PORT, method: 'POST', agent, headers }, (res) => {
        const port = req.socket?.localPort;
        res.resume();
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, port }); });
      });
      req.on('error', reject);
      req.end(body);
    });

    try {
      const refused = await post(Buffer.alloc(1024 * 1024, 0x41), { 'content-encoding': 'zstd' });
      const accepted = await post(Buffer.from(HL7), {});
      expect([refused.status, accepted.status]).toEqual([415, 200]);
      expect(accepted.port).toBe(refused.port);
      expect(seen.map((raw) => raw.content)).toEqual([HL7]);
    } finally {
      agent.destroy();
    }
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
function sendRaw(head: string, afterContinue?: () => Promise<string>): Promise<string> {
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

  it('dispatches a request whose body was still arriving when the channel was undeployed', async () => {
    const { seen } = await startRecording();

    const head = 'POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n';
    const answer = await sendRaw(head, async () => {
      await receiver?.onUndeploy();
      return 'hello';
    });

    expect(answer).toContain('HTTP/1.1 200 ');
    expect(seen.map((raw) => raw.content)).toEqual(['hello']);
  });

  it('answers 503 to a request that arrives after the channel was undeployed', async () => {
    const { seen } = await startRecording();
    await receiver?.onUndeploy();

    const res = await sendRequest(TEST_PORT, { body: 'late' });

    expect(res.status).toBe(503);
    expect(seen).toEqual([]);
  });
});
