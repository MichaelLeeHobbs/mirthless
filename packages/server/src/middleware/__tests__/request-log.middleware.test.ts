// ===========================================
// Request Log Middleware Tests
// ===========================================
// Exercised over real HTTP with a real pino logger, so the assertion is on the
// JSON line pino-http actually writes (#229: search terms are usually MRNs).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { requestLogger, urlWithoutQueryValues } from '../request-log.middleware.js';

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
