// ===========================================
// Body Limit Middleware Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jsonBody, isLargeBodyRoute } from '../body-limit.middleware.js';

let server: Server | null = null;

async function post(path: string, bytes: number): Promise<number> {
  const app = express();
  app.use(jsonBody);
  app.post(/.*/, (req, res) => { res.json({ size: JSON.stringify(req.body).length }); });
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ content: 'x'.repeat(bytes) }),
  });
  return response.status;
}

afterEach(async () => {
  const running = server;
  if (running) await new Promise((resolve) => { running.close(resolve); });
  server = null;
});

describe('jsonBody', () => {
  const TWO_MB = 2 * 1024 * 1024;

  it.each([
    '/api/v1/system/backup',
    '/api/v1/channels/import',
    '/api/v1/channels/import/mirth',
    '/api/v1/channels/import/mirth/preview',
    '/api/v1/channels/00000000-0000-0000-0000-000000000001/send-message',
  ])('accepts a 2 MB body on %s', async (path) => {
    expect(await post(path, TWO_MB)).toBe(200);
  });

  it.each([
    '/api/v1/auth/login',
    '/api/v1/channels',
    '/api/v1/channels/00000000-0000-0000-0000-000000000001',
    '/api/v1/system/backup/extra',
  ])('rejects a 2 MB body on %s', async (path) => {
    expect(await post(path, TWO_MB)).toBe(413);
  });

  it('still accepts a small body everywhere', async () => {
    expect(await post('/api/v1/auth/login', 100)).toBe(200);
  });

  it('rejects a body over the large limit even on a large-body route', async () => {
    expect(await post('/api/v1/system/backup', 51 * 1024 * 1024)).toBe(413);
  });
});

describe('isLargeBodyRoute', () => {
  it('ignores a trailing slash and the query string is not part of the path', () => {
    expect(isLargeBodyRoute('/api/v1/channels/import/')).toBe(true);
    expect(isLargeBodyRoute('/api/v1/channels/importer')).toBe(false);
  });
});
