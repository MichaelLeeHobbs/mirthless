// ===========================================
// PUT /channels/:id/groups route tests (#223)
// ===========================================
// Sends real requests through the channel router, the real permission and
// validation middleware and the real controller. Only the service (the database
// boundary) and auth are stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../middleware/auth.middleware.js', () => ({
  // Stands in for JWT auth: the test names the caller's permissions in a header.
  authenticate: vi.fn((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const header = req.header('x-test-permissions') ?? '';
    req.user = {
      id: 'user-1',
      username: 'tester',
      email: 'tester@example.com',
      role: 'test',
      isActive: true,
      permissions: header === '' ? [] : header.split(','),
      mustChangePassword: false,
    };
    next();
  }),
}));

const { setChannelGroups } = vi.hoisted(() => ({ setChannelGroups: vi.fn() }));

vi.mock('../../services/channel-group.service.js', () => ({ ChannelGroupService: { setChannelGroups } }));
// The other channel routes are not under test; any handler will do.
vi.mock('../../controllers/channel.controller.js', () => ({
  ChannelController: new Proxy({}, { get: () => (_req: unknown, res: express.Response) => { res.status(418).end(); } }),
}));
vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const router = (await import('../channel.routes.js')).default;
const { ServiceError } = await import('../../lib/service-error.js');

const CHANNEL_ID = '3b6f8f0e-2a4c-4d1e-9b7a-5c2d1e0f9a8b';
const G1 = '6f1c2a4e-8b3d-4c7a-9e21-0a5b7c9d1e2f';
const G2 = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const WRITE = ['channels:read', 'channels:write'];

let server: Server | null = null;

interface Reply { readonly status: number; readonly body: unknown }

async function put(path: string, body: unknown, permissions: readonly string[]): Promise<Reply> {
  const app = express();
  app.use(express.json());
  app.use('/channels', router);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${String(port)}/channels${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-permissions': permissions.join(','), connection: 'close' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as unknown };
}

beforeEach(() => { setChannelGroups.mockReset(); });

afterEach(async () => {
  const running = server;
  if (running) await new Promise((resolve) => { running.close(resolve); });
  server = null;
});

describe('PUT /channels/:id/groups', () => {
  it('sets the groups and answers with the new set', async () => {
    setChannelGroups.mockResolvedValue({ ok: true, value: { channelId: CHANNEL_ID, groupIds: [G1, G2] }, error: null });

    const reply = await put(`/${CHANNEL_ID}/groups`, { groupIds: [G1, G2] }, WRITE);

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ success: true, data: { channelId: CHANNEL_ID, groupIds: [G1, G2] } });
    expect(setChannelGroups).toHaveBeenCalledWith(CHANNEL_ID, [G1, G2], { userId: 'user-1', ipAddress: expect.any(String) });
  });

  it('accepts an empty list, which takes the channel out of every group', async () => {
    setChannelGroups.mockResolvedValue({ ok: true, value: { channelId: CHANNEL_ID, groupIds: [] }, error: null });

    const reply = await put(`/${CHANNEL_ID}/groups`, { groupIds: [] }, WRITE);

    expect(reply.status).toBe(200);
    expect(setChannelGroups).toHaveBeenCalledWith(CHANNEL_ID, [], expect.anything());
  });

  it('passes group ids to the service in lower case', async () => {
    setChannelGroups.mockResolvedValue({ ok: true, value: { channelId: CHANNEL_ID, groupIds: [G1] }, error: null });

    const reply = await put(`/${CHANNEL_ID}/groups`, { groupIds: [G1.toUpperCase()] }, WRITE);

    expect(reply.status).toBe(200);
    expect(setChannelGroups).toHaveBeenCalledWith(CHANNEL_ID, [G1], expect.anything());
  });

  it('answers 403 without channels:write and never calls the service', async () => {
    const reply = await put(`/${CHANNEL_ID}/groups`, { groupIds: [G1] }, ['channels:read']);

    expect(reply.status).toBe(403);
    expect(setChannelGroups).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing groupIds', {}],
    ['a group id that is not a uuid', { groupIds: ['nope'] }],
    ['the same group twice', { groupIds: [G1, G1] }],
    ['the same group in upper and lower case', { groupIds: [G1, G1.toUpperCase()] }],
    ['more than 1000 groups', { groupIds: Array.from({ length: 1001 }, (_v, i) => `${i.toString(16).padStart(8, '0')}-8b3d-4c7a-9e21-0a5b7c9d1e2f`) }],
  ])('answers 400 for %s', async (_label, body) => {
    const reply = await put(`/${CHANNEL_ID}/groups`, body, WRITE);

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(setChannelGroups).not.toHaveBeenCalled();
  });

  it('answers 400 for a channel id that is not a uuid', async () => {
    const reply = await put('/not-a-uuid/groups', { groupIds: [G1] }, WRITE);

    expect(reply.status).toBe(400);
    expect(setChannelGroups).not.toHaveBeenCalled();
  });

  it.each([
    ['channel', `Channel ${CHANNEL_ID} not found`],
    ['group', `Channel group not found: ${G2}`],
  ])('answers 404 with the reason for an unknown %s', async (_label, message) => {
    setChannelGroups.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', message) });

    const reply = await put(`/${CHANNEL_ID}/groups`, { groupIds: [G1, G2] }, WRITE);

    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message } });
  });

  it('answers 500 without the cause when the transaction fails', async () => {
    setChannelGroups.mockResolvedValue({ ok: false, value: null, error: new Error('insert or update violates foreign key constraint') });

    const reply = await put(`/${CHANNEL_ID}/groups`, { groupIds: [G1] }, WRITE);

    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});
