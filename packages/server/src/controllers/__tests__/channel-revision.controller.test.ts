// A revision snapshot carries the full connector config, so readers without
// channels:write must get credentials masked exactly as on GET /channels/:id.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockService = {
  listRevisions: vi.fn(),
  getRevision: vi.fn(),
};

vi.mock('../../services/channel-revision.service.js', () => ({
  ChannelRevisionService: mockService,
}));

vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { ChannelRevisionController } = await import('../channel-revision.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');
const { REDACTED } = await import('../../lib/secret-redaction.js');
const { standingFor } = await import('../../../test/standing.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

/** `channelScope` is the channel's groups, as scopeToChannel reads them. */
function makeReq(role: string, groups?: readonly string[], channelScope?: readonly string[]): Request {
  const standing = standingFor({ id: 'u1', role, ...(groups ? { groups } : {}) });
  return {
    params: { id: '00000000-0000-0000-0000-000000000001', rev: '3' },
    user: { id: 'u1', permissions: standing.permissions },
    principal: { userId: 'u1', grants: standing.grants },
    ...(channelScope ? { channelScope } : {}),
  } as unknown as Request;
}

function makeRevision(): Record<string, unknown> {
  return {
    id: 'r1',
    channelId: '00000000-0000-0000-0000-000000000001',
    revision: 3,
    userId: 'u1',
    comment: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    snapshot: {
      name: 'Lab',
      sourceConnectorProperties: { port: 6661, auth: { password: 'src-secret' } },
      destinations: [{ name: 'DB', properties: { username: 'svc', password: 'db-secret', tls: { key: 'PEM' } } }],
    },
  };
}

function sentData(res: Response): Record<string, unknown> {
  const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { data: Record<string, unknown> };
  return body.data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelRevisionController.list', () => {
  it('answers 404 with the service error when the channel does not exist', async () => {
    mockService.listRevisions.mockResolvedValue({ ok: false, error: new ServiceError('NOT_FOUND', 'Channel not found') });
    const res = makeRes();

    await ChannelRevisionController.list(makeReq('viewer'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Channel not found' } });
  });

  it('answers 500 with a generic body for an error that is not a service error', async () => {
    mockService.listRevisions.mockResolvedValue({ ok: false, error: new Error('connection refused') });
    const res = makeRes();

    await ChannelRevisionController.list(makeReq('viewer'), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});

describe('ChannelRevisionController.getByRevision', () => {
  it('masks snapshot credentials for a caller without channels:write', async () => {
    mockService.getRevision.mockResolvedValue({ ok: true, value: makeRevision() });
    const res = makeRes();

    await ChannelRevisionController.getByRevision(makeReq('viewer'), res);

    const snapshot = sentData(res)['snapshot'] as Record<string, unknown>;
    expect(snapshot['sourceConnectorProperties']).toEqual({ port: 6661, auth: { password: REDACTED } });
    expect(snapshot['destinations']).toEqual([
      { name: 'DB', properties: { username: 'svc', password: REDACTED, tls: { key: REDACTED } } },
    ]);
  });

  it.each([
    ['on every channel', undefined, undefined],
    ['in the channel\'s group', ['group-a'], ['group-a']],
  ])('returns the snapshot unmasked for a caller with channels:write %s', async (_where, groups, channelScope) => {
    mockService.getRevision.mockResolvedValue({ ok: true, value: makeRevision() });
    const res = makeRes();

    await ChannelRevisionController.getByRevision(makeReq('channel-developer', groups, channelScope), res);

    expect(sentData(res)['snapshot']).toEqual(makeRevision()['snapshot']);
  });

  it('masks for a caller with channels:write only on another channel', async () => {
    mockService.getRevision.mockResolvedValue({ ok: true, value: makeRevision() });
    const res = makeRes();

    await ChannelRevisionController.getByRevision(makeReq('channel-developer', ['group-b'], ['group-a']), res);

    const snapshot = sentData(res)['snapshot'] as Record<string, unknown>;
    expect(snapshot['sourceConnectorProperties']).toEqual({ port: 6661, auth: { password: REDACTED } });
  });

  it('masks when the request has no user', async () => {
    mockService.getRevision.mockResolvedValue({ ok: true, value: makeRevision() });
    const res = makeRes();
    const req = { params: { id: 'x', rev: '3' } } as unknown as Request;

    await ChannelRevisionController.getByRevision(req, res);

    const snapshot = sentData(res)['snapshot'] as Record<string, unknown>;
    expect(snapshot['sourceConnectorProperties']).toEqual({ port: 6661, auth: { password: REDACTED } });
  });

  it('returns 404 when the revision does not exist', async () => {
    mockService.getRevision.mockResolvedValue({ ok: false, error: new ServiceError('NOT_FOUND', 'Revision not found') });
    const res = makeRes();

    await ChannelRevisionController.getByRevision(makeReq('viewer'), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
