// GHSA-r434-hwqg-cvcw: anyone holding JWT_SECRET could sign an access token with
// no sessionId, and the revocation check let it through.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const ADMIN = {
  id: '00000000-0000-0000-0000-0000000000a1', username: 'admin', email: 'admin@example.test',
  role: 'admin', enabled: true, mustChangePassword: false,
};
const SESSION_ID = '00000000-0000-0000-0000-0000000000b1';

vi.mock('../../lib/db.js', async () => {
  const schema = await import('../../db/schema/index.js');
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => Promise.resolve(table === schema.sessions ? [{ id: SESSION_ID }] : []),
      }),
    }),
  };
  return { db, default: db };
});
vi.mock('../../lib/principal.js', async () => {
  const { standingFor } = await import('../../../test/standing.js');
  return {
    loadUserStanding: vi.fn(() => Promise.resolve(standingFor(ADMIN))),
    roleLabel: (names: readonly string[]) => names.join(', '),
  };
});

const { authenticate } = await import('../../middleware/auth.middleware.js');
const { signAccessToken } = await import('../../lib/jwt.js');

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.get('/whoami', authenticate, (req, res) => { res.json({ role: req.user?.role }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

async function whoami(token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}/whoami`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

describe('authenticate with a token signed outside the server', () => {
  it('refuses an access token for an admin that carries no session id', async () => {
    const forged = jwt.sign({ userId: ADMIN.id, type: 'access' }, process.env['JWT_SECRET'] ?? '', {
      algorithm: 'HS256', expiresIn: '15m',
    });

    const { status, body } = await whoami(forged);

    expect(status).toBe(401);
    expect(body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('accepts a token the server issued, which carries a live session id', async () => {
    const { status, body } = await whoami(signAccessToken({ userId: ADMIN.id, sessionId: SESSION_ID }));

    expect(status).toBe(200);
    expect(body).toEqual({ role: 'admin' });
  });
});
