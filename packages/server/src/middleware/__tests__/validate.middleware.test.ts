// ===========================================
// Validation Middleware Tests
// ===========================================
// Exercised over real HTTP so the Express request object is the real one
// (Express 5 makes req.query a getter, which a mocked request would hide).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod/v4';
import { validate } from '../validate.middleware.js';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const echo = (req: express.Request, res: express.Response): void => {
    res.json({ query: req.query, params: req.params, body: req.body as unknown });
  };
  app.get(
    '/items',
    validate({ query: z.object({ page: z.coerce.number().int().min(1).default(1) }) }),
    echo,
  );
  app.get('/items/:id', validate({ params: z.object({ id: z.uuid() }) }), echo);
  app.post('/items', validate({ body: z.object({ name: z.string().min(1) }) }), echo);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => { server.once('listening', () => { resolve(); }); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

describe('validate', () => {
  it('replaces req.query with the coerced, defaulted value', async () => {
    const res = await fetch(`${base}/items?page=3`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ query: { page: 3 } });

    const defaulted = await fetch(`${base}/items`);
    expect(await defaulted.json()).toMatchObject({ query: { page: 1 } });
  });

  it('returns 400 VALIDATION_ERROR for an invalid query', async () => {
    const res = await fetch(`${base}/items?page=0`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns 400 for invalid params', async () => {
    const res = await fetch(`${base}/items/not-a-uuid`);
    expect(res.status).toBe(400);
  });

  it('passes valid params through', async () => {
    const id = '7f3c2a1e-5b4d-4c3e-9a2b-1c0d9e8f7a6b';
    const res = await fetch(`${base}/items/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ params: { id } });
  });

  it('returns 400 for an invalid body and passes a valid one', async () => {
    const bad = await fetch(`${base}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(bad.status).toBe(400);

    const good = await fetch(`${base}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'adt' }),
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ body: { name: 'adt' } });
  });

  it('rejects a missing body (Express 5 leaves req.body undefined)', async () => {
    const res = await fetch(`${base}/items`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
