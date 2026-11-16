// ===========================================
// Error Handler Tests
// ===========================================
// A body the parser refuses (too large, not JSON) is the caller's mistake: it
// keeps its 4xx status instead of becoming a 500, and the reply never echoes
// the body, which can hold PHI.

import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { errorHandler } from '../error.middleware.js';
import logger from '../../lib/logger.js';

let server: Server | null = null;

afterEach(async () => {
  const running = server;
  if (running) await new Promise((resolve) => { running.close(resolve); });
  server = null;
});

async function post(body: string, failure?: Error): Promise<{ readonly status: number; readonly text: string }> {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/', (_req, _res, next) => { next(failure); });
  app.use(errorHandler);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${String(port)}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body,
  });
  return { status: res.status, text: await res.text() };
}

describe('errorHandler', () => {
  it('answers malformed JSON with 400 and does not echo the body', async () => {
    const { status, text } = await post('{"mrn":"MRN-12345",');
    expect(status).toBe(400);
    expect(JSON.parse(text)).toEqual({ success: false, error: { code: 'BAD_REQUEST', message: 'The request body could not be read' } });
    expect(text).not.toContain('MRN-12345');
  });

  it('logs the parser error type and never the body text', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await post('{"mrn":"MRN-12345",');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatchObject({ status: 400, type: 'entity.parse.failed' });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('MRN-12345');
    } finally {
      warn.mockRestore();
    }
  });

  it('answers a body over the limit with 413', async () => {
    const { status, text } = await post(JSON.stringify({ pad: 'x'.repeat(2048) }));
    expect(status).toBe(413);
    expect(JSON.parse(text)).toEqual({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large' } });
  });

  it('answers any other error with 500', async () => {
    const { status, text } = await post('{}', new Error('boom'));
    expect(status).toBe(500);
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('INTERNAL');
  });

  it('answers a 4xx error that is not marked safe to expose with 500', async () => {
    const hidden = Object.assign(new Error('internal detail'), { status: 404, expose: false });
    expect((await post('{}', hidden)).status).toBe(500);
  });
});
