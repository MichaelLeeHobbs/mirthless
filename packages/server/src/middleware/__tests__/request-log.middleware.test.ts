// A real pino logger, so the assertions read the JSON line pino-http actually
// writes (#229).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { requestLogger, urlWithoutQueryValues } from '../request-log.middleware.js';
import { errorResponse, mapErrorToStatus } from '../../lib/controller-helpers.js';
import { ServiceError } from '../../lib/service-error.js';

const MRN = 'MRN-4471-SECRET';

interface Harness { readonly server: Server; readonly base: string; readonly lines: string[] }

async function startApp(includeHeaders: boolean): Promise<Harness> {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void { lines.push(chunk.toString('utf8')); cb(); },
  });
  const app = express();
  app.use(requestLogger(pino(sink), includeHeaders));
  app.get('/api/v1/channels/:id/messages', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => { server.once('listening', () => { resolve(); }); });
  return { server, base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, lines };
}

async function stopApp(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => { h.server.close(() => { resolve(); }); });
}

async function logLineFor(h: Harness, path: string): Promise<string> {
  const before = h.lines.length;
  const res = await fetch(`${h.base}${path}`);
  expect(res.status).toBe(200);
  await expect.poll(() => h.lines.length).toBeGreaterThan(before);
  return h.lines[before] ?? '';
}

describe.each([false, true])('requestLogger (LOG_HTTP_HEADERS=%s)', (includeHeaders) => {
  let h: Harness;
  beforeAll(async () => { h = await startApp(includeHeaders); });
  afterAll(async () => { await stopApp(h); });

  it('logs the path and query parameter names but never their values', async () => {
    const line = await logLineFor(h, `/api/v1/channels/c1/messages?contentSearch=${MRN}&metaDataValue=${MRN}&limit=25`);
    expect(line).not.toContain(MRN);
    const record = JSON.parse(line) as { req: Record<string, unknown>; res: { statusCode: number } };
    expect(record.req['url']).toBe('/api/v1/channels/c1/messages?contentSearch&metaDataValue&limit');
    expect(record.req['method']).toBe('GET');
    expect(record.req).not.toHaveProperty('query');
    expect(record.res.statusCode).toBe(200);
  });

  it(includeHeaders ? 'adds the request headers' : 'leaves the request headers out', async () => {
    const line = await logLineFor(h, '/api/v1/channels/c1/messages');
    const record = JSON.parse(line) as { req: Record<string, unknown> };
    expect(record.req['url']).toBe('/api/v1/channels/c1/messages');
    expect(record.req['headers'] !== undefined).toBe(includeHeaders);
  });
});

describe('urlWithoutQueryValues', () => {
  it('keeps a URL with no query string as it is', () => {
    expect(urlWithoutQueryValues('/api/v1/channels')).toBe('/api/v1/channels');
  });

  it('drops an empty query string', () => {
    expect(urlWithoutQueryValues('/api/v1/channels?')).toBe('/api/v1/channels');
  });

  it('lists a repeated parameter name once, in first-seen order', () => {
    expect(urlWithoutQueryValues('/m?status=A&q=x&status=B')).toBe('/m?status&q');
  });

  it('drops values that are percent-encoded or empty', () => {
    expect(urlWithoutQueryValues('/m?contentSearch=Doe%2C%20Jane&empty=')).toBe('/m?contentSearch&empty');
  });

  it('hides a bare token with no "=", which may be the value itself', () => {
    expect(urlWithoutQueryValues('/m?MRN123456')).toBe('/m?<redacted>');
    expect(urlWithoutQueryValues('/m?limit=25&MRN123456')).toBe('/m?limit&<redacted>');
  });

  it('hides a name that decodes to anything but a plain parameter name', () => {
    expect(urlWithoutQueryValues('/m?n%3DMRN99=1')).toBe('/m?<redacted>');
    expect(urlWithoutQueryValues('/m?Doe%2C%20Jane=1')).toBe('/m?<redacted>');
    expect(urlWithoutQueryValues('/m?123=1')).toBe('/m?<redacted>');
    expect(urlWithoutQueryValues(`/m?${'a'.repeat(65)}=1`)).toBe('/m?<redacted>');
    expect(urlWithoutQueryValues('/m?bad%E0%A4%A=1')).toBe('/m?<redacted>');
  });

  it('logs an allowed name percent-encoded', () => {
    expect(urlWithoutQueryValues('/m?filter[status]=SENT&a.b-c_d=1')).toBe('/m?filter%5Bstatus%5D&a.b-c_d');
  });
});

// At `warn`, an INTERNAL answer used to leave no line at all, and at `info` no cause (#473).
describe('requestLogger: an INTERNAL answer carries its cause', () => {
  let h: Harness;

  function failingRead(): Error {
    // As a QueryError: its message names the statement, its cause can quote a value (D-347).
    return new Error('select "messages" failed: connection timeout', { cause: new Error(`value ${MRN} not found`) });
  }

  beforeAll(async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void { lines.push(chunk.toString('utf8')); cb(); },
    });
    const app = express();
    app.use((req, _res, next) => { req.id = 'req-473'; next(); });
    app.use(requestLogger(pino({ level: 'warn' }, sink), false));
    const answer = (error: unknown) => (_req: express.Request, res: express.Response): void => {
      res.status(mapErrorToStatus(error)).json({ success: false, error: errorResponse(error) });
    };
    app.get('/unexpected', answer(failingRead()));
    app.get('/internal', answer(new ServiceError('INTERNAL', 'Could not read the channel')));
    app.get('/thrown-string', answer('socket hang up'));
    app.get('/missing', answer(new ServiceError('NOT_FOUND', 'Channel not found')));
    app.get('/busy', answer(new ServiceError('UNAVAILABLE', 'Try again')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => { server.once('listening', () => { resolve(); }); });
    h = { server, base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, lines };
  });
  afterAll(async () => { await stopApp(h); });

  async function call(path: string, status: number): Promise<void> {
    const res = await fetch(`${h.base}${path}`);
    expect(res.status).toBe(status);
    await res.text();
  }

  /** The lines written from `before` on, once the one for an INTERNAL answer has arrived. */
  async function linesAfter(before: number): Promise<readonly Record<string, unknown>[]> {
    await expect.poll(() => h.lines.length).toBeGreaterThan(before);
    return h.lines.slice(before).map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  it('logs an unexpected failure at error, with its message, the request id and nothing its cause quotes', async () => {
    const before = h.lines.length;
    await call('/unexpected', 500);
    const lines = await linesAfter(before);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 50, requestId: 'req-473', res: { statusCode: 500 }, err: { errMsg: 'select "messages" failed: connection timeout', name: 'Error' } });
    expect(h.lines.slice(before).join('')).not.toContain(MRN);
  });

  it('logs an INTERNAL service error and a thrown value that is not an Error', async () => {
    let before = h.lines.length;
    await call('/internal', 500);
    expect(await linesAfter(before)).toEqual([expect.objectContaining({ level: 50, err: expect.objectContaining({ errMsg: 'Could not read the channel' }) })]);
    before = h.lines.length;
    await call('/thrown-string', 500);
    expect(await linesAfter(before)).toEqual([expect.objectContaining({ level: 50, err: { errMsg: 'socket hang up' } })]);
  });

  it('writes nothing at warn for an answer that is not INTERNAL', async () => {
    const before = h.lines.length;
    await call('/missing', 404);
    await call('/busy', 503);
    // Lines are written in order, so once this one is there the two before it would be too.
    await call('/internal', 500);
    const lines = await linesAfter(before);
    expect(lines.map((l) => (l['req'] as { url: string }).url)).toEqual(['/internal']);
  });
});
