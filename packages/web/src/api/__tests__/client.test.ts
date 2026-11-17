// ===========================================
// apiFetch token refresh (#219)
// ===========================================
// When a request comes back 401, apiFetch refreshes the session and retries.
// The refresh answer carries the user as they are now, so the stored
// permission list follows a role change instead of keeping the sign-in list.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { accessKey, apiFetch, checkAccess, isChannelPath, resetAccessCheck } from '../client.js';
import { useAuthStore } from '../../stores/auth.store.js';
import type { ChannelGroupId } from '@galvanigraph/core-models';

const SIGNED_IN = {
  id: 'u1', username: 'kpatel', email: 'kpatel@example.test', role: 'deployer',
  permissions: ['channels:read', 'channels:deploy'],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A 401, then the refresh answer, then the retried request's answer. */
function stubFetch(refreshBody: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(json(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }))
    .mockResolvedValueOnce(json(200, refreshBody))
    .mockResolvedValueOnce(json(200, { success: true, data: { ok: true } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setAuth(SIGNED_IN, 'old-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clearAuth();
});

describe('apiFetch refresh', () => {
  it('replaces the stored user and permissions with the ones the refresh returns', async () => {
    const fetchMock = stubFetch({
      success: true,
      data: {
        accessToken: 'new-token',
        user: { ...SIGNED_IN, role: 'viewer', permissions: ['channels:read'], mustChangePassword: false },
      },
    });

    const result = await apiFetch('/channels');

    expect(result.success).toBe(true);
    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-token');
    expect(state.user?.role).toBe('viewer');
    expect(state.user?.permissions).toEqual(['channels:read']);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/channels', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer new-token' }) as unknown,
    }));
  });

  it('keeps the scoped grants the refresh returns, so screens that depend on scope keep working', async () => {
    const grants = [{ permission: 'channels:write', scope: ['g1', 'g2'] }, { permission: 'channels:read', scope: 'all' }];
    stubFetch({ success: true, data: { accessToken: 'new-token', user: { ...SIGNED_IN, grants } } });
    await apiFetch('/channels');
    expect(useAuthStore.getState().user?.grants).toEqual(grants);
  });

  it('drops grants it cannot read rather than storing them half-read', async () => {
    stubFetch({ success: true, data: { accessToken: 'new-token', user: { ...SIGNED_IN, grants: [{ permission: 'channels:write', scope: 7 }] } } });
    await apiFetch('/channels');
    expect(useAuthStore.getState().user?.grants).toBeUndefined();
    expect(useAuthStore.getState().user?.permissions).toEqual(SIGNED_IN.permissions);
  });

  it('takes the forced password change flag from the refresh', async () => {
    stubFetch({ success: true, data: { accessToken: 'new-token', user: { ...SIGNED_IN, mustChangePassword: true } } });

    await apiFetch('/channels');

    expect(useAuthStore.getState().mustChangePassword).toBe(true);
  });

  it('keeps the stored user when the refresh answer carries none', async () => {
    stubFetch({ success: true, data: { accessToken: 'new-token' } });

    await apiFetch('/channels');

    expect(useAuthStore.getState().accessToken).toBe('new-token');
    expect(useAuthStore.getState().user?.permissions).toEqual(SIGNED_IN.permissions);
  });

  it('signs out when the refresh is refused', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(401, { success: false }))
      .mockResolvedValueOnce(json(401, { success: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/channels');

    expect(result.success).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('access check (D-310)', () => {
  const groups = (...ids: string[]): readonly ChannelGroupId[] => ids as ChannelGroupId[];
  const refreshed = (grants: unknown): Response => json(200, { success: true, data: { accessToken: 'new-token', user: { ...SIGNED_IN, grants } } });

  beforeEach(() => { resetAccessCheck(); });

  it('refreshes after a 404 and notes that the access changed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(404, { success: false, error: { code: 'NOT_FOUND', message: 'Channel not found' } }))
      .mockResolvedValueOnce(refreshed([{ permission: 'channels:read', scope: ['g1'] }]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/channels/0b6f1c2e-1111-4222-8333-944445555666');

    expect(result.success).toBe(false);
    await vi.waitFor(() => { expect(useAuthStore.getState().accessChangedAt).not.toBeNull(); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/auth/refresh', expect.anything());
  });

  it('notes nothing when a refresh finds the same access', async () => {
    useAuthStore.getState().setAccessChanged(null);
    useAuthStore.getState().setAuth({ ...SIGNED_IN, grants: [{ permission: 'channels:read', scope: groups('g1') }] }, 'old-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(refreshed([{ permission: 'channels:read', scope: ['g1'] }])));

    await checkAccess(true);

    expect(useAuthStore.getState().accessChangedAt).toBeNull();
  });

  it('checks only after a 404 from a route for one channel', () => {
    expect(isChannelPath('/channels/0b6f1c2e-1111-4222-8333-944445555666')).toBe(true);
    expect(isChannelPath('/channels/0b6f1c2e-1111-4222-8333-944445555666/messages?limit=25')).toBe(true);
    expect(isChannelPath('/channels')).toBe(false);
    expect(isChannelPath('/channels/statistics')).toBe(false);
    expect(isChannelPath('/alerts/0b6f1c2e-1111-4222-8333-944445555666')).toBe(false);
  });

  it('retries a 401 with a token a refresh stored meanwhile, before rotating the session again', async () => {
    const fetchMock = vi.fn().mockImplementationOnce(async () => {
      // A refresh elsewhere finished while this request was in flight.
      useAuthStore.getState().setAccessToken('rotated-token');
      return json(401, { success: false });
    }).mockResolvedValueOnce(json(200, { success: true, data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/channels');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/channels', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer rotated-token' }) as unknown,
    }));
  });

  it('compares scopes regardless of order', () => {
    const a = accessKey({ ...SIGNED_IN, grants: [{ permission: 'channels:read', scope: groups('g2', 'g1') }] });
    const b = accessKey({ ...SIGNED_IN, grants: [{ permission: 'channels:read', scope: groups('g1', 'g2') }] });
    expect(a).toBe(b);
    expect(a).not.toBe(accessKey({ ...SIGNED_IN, grants: [{ permission: 'channels:read', scope: 'all' }] }));
  });
});
