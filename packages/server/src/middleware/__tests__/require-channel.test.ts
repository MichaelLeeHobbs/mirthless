// ===========================================
// Channel scope on channel routes (D-310)
// ===========================================
// scopeToChannel reads the groups of the channel a route names; the route's
// requirePermission then checks the permission on that channel. The groups
// come from lib/channel-scope.ts, the database boundary, faked here; that the
// lookup reads real memberships, through the real routes, is proven against
// Postgres in test/integration/channel-scope.itest.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response, Router } from 'express';
import { ALL_CHANNELS, foldGrants, type AssignmentGrant, type ChannelGroupId } from '@galvanigraph/core-models';

const { groupsOf } = vi.hoisted(() => ({ groupsOf: vi.fn<(id: string) => Promise<readonly string[]>>() }));
vi.mock('../../lib/channel-scope.js', () => ({ channelGroupIds: groupsOf }));
vi.mock('../../lib/event-emitter.js', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { requirePermission, requireAllPermissions, scopeToChannel } = await import('../permission.middleware.js');

const LAB = 'g-lab' as ChannelGroupId;
const RAD = 'g-rad' as ChannelGroupId;
const CHANNEL = '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c';

function reqWith(assignments: readonly AssignmentGrant[]): Request {
  const grants = foldGrants(assignments, new Date());
  return {
    method: 'GET', baseUrl: '/api/v1/channels', originalUrl: `/api/v1/channels/${CHANNEL}`, route: { path: '/:id' },
    params: { id: CHANNEL }, ip: '10.0.0.7',
    user: { id: 'u1', permissions: [...grants.keys()] },
    principal: { userId: 'u1', grants },
  } as unknown as Request;
}

function resStub(): Response & { statusCode?: number; body?: { error?: { code?: string } } } {
  const res = {} as Response & { statusCode?: number; body?: { error?: { code?: string } } };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((b: unknown) => { res.body = b as never; return res; }) as unknown as Response['json'];
  return res;
}

/** Run scopeToChannel's lookup for `value`, as Express would before the route's guard. */
async function lookUp(req: Request, value: unknown = CHANNEL): Promise<unknown> {
  let handler: ((req: Request, res: Response, next: NextFunction, value: unknown) => void) | undefined;
  scopeToChannel({ param: (_name: string, fn: typeof handler) => { handler = fn; } } as unknown as Router);
  return new Promise((resolve) => { handler?.(req, resStub(), (err?: unknown) => { resolve(err); }, value); });
}

beforeEach(() => { groupsOf.mockReset(); });

describe('scopeToChannel', () => {
  it('skips the lookup for a caller whose every grant covers all channels', async () => {
    const req = reqWith([{ permissions: ['messages:read'], scope: ALL_CHANNELS }]);
    await lookUp(req);
    expect(groupsOf).not.toHaveBeenCalled();
    expect(req.channelScope).toBeUndefined();
  });

  it('reads the groups of the channel the path names', async () => {
    groupsOf.mockResolvedValue([RAD, LAB]);
    const req = reqWith([{ permissions: ['messages:read'], scope: [LAB] }]);
    await lookUp(req);
    expect(groupsOf).toHaveBeenCalledWith(CHANNEL);
    expect(req.channelScope).toEqual([RAD, LAB]);
  });

  it('treats a path value that is not a channel id as in no group, without a query', async () => {
    const req = reqWith([{ permissions: ['messages:read'], scope: [LAB] }]);
    await lookUp(req, 'not-a-uuid');
    expect(groupsOf).not.toHaveBeenCalled();
    expect(req.channelScope).toEqual([]);
  });

  it('passes a lookup failure on, so the request fails rather than skipping the check', async () => {
    groupsOf.mockRejectedValue(new Error('connection lost'));
    const req = reqWith([{ permissions: ['messages:read'], scope: [LAB] }]);
    expect(await lookUp(req)).toBeInstanceOf(Error);
  });
});

describe('requirePermission on a channel route', () => {
  it('lets a scoped grant through on a channel in one of its groups', () => {
    const req = reqWith([{ permissions: ['messages:read'], scope: [LAB] }]);
    req.channelScope = [LAB];
    const next = vi.fn();
    requirePermission('messages:read')(req, resStub(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('answers a channel outside the scope as not found', () => {
    const req = reqWith([{ permissions: ['messages:read'], scope: [LAB] }]);
    req.channelScope = [RAD];
    const next = vi.fn();
    const res = resStub();
    requirePermission('messages:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body?.error?.code).toBe('NOT_FOUND');
  });

  it('needs every permission on the same channel when all are required', () => {
    const req = reqWith([
      { permissions: ['messages:read'], scope: [LAB] },
      { permissions: ['messages:reprocess'], scope: [RAD] },
    ]);
    req.channelScope = [LAB];
    const res = resStub();
    requireAllPermissions('messages:read', 'messages:reprocess')(req, res, vi.fn());
    expect(res.statusCode).toBe(404);
  });

  it('still answers 403 for a permission held nowhere, before scope', () => {
    const req = reqWith([{ permissions: ['channels:read'], scope: [LAB] }]);
    req.channelScope = [LAB];
    const res = resStub();
    requirePermission('messages:read')(req, res, vi.fn());
    expect(res.statusCode).toBe(403);
  });
});
