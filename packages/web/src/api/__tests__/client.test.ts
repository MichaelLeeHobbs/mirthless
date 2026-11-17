// ===========================================
// apiFetch token refresh (#219)
// ===========================================
// When a request comes back 401, apiFetch refreshes the session and retries.
// The refresh answer carries the user as they are now, so the stored
// permission list follows a role change instead of keeping the sign-in list.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from '../client.js';
import { useAuthStore } from '../../stores/auth.store.js';

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
