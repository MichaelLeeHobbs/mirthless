// ===========================================
// Login Tests
// ===========================================
// Uses the response shape the server really sends from POST /auth/login
// (packages/server/src/controllers/auth.controller.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../lib/api.js';
import { login } from '../commands/login.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function respond(status: number, body: unknown): void {
  mockFetch.mockResolvedValue({ status, json: () => Promise.resolve(body) } as Response);
}

const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });

describe('login', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns the access token from the server response', async () => {
    respond(200, { success: true, data: { user: { id: 'u1', username: 'admin' }, accessToken: 'jwt-abc' } });

    expect(await login(client, 'admin', 'secret')).toEqual({ ok: true, token: 'jwt-abc' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ username: 'admin', password: 'secret' }) }),
    );
  });

  it('fails when the response has no access token, instead of saving nothing as a login', async () => {
    respond(200, { success: true, data: { user: { id: 'u1' } } });

    expect(await login(client, 'admin', 'secret')).toEqual({ ok: false, message: 'The server did not return an access token' });
  });

  it('fails when the access token is empty', async () => {
    respond(200, { success: true, data: { accessToken: '' } });

    expect((await login(client, 'admin', 'secret')).ok).toBe(false);
  });

  it('reports the server message on bad credentials', async () => {
    respond(401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });

    expect(await login(client, 'admin', 'wrong')).toEqual({ ok: false, message: 'Invalid username or password' });
  });

  it('reports a server that cannot be reached', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));

    expect(await login(client, 'admin', 'secret')).toEqual({ ok: false, message: 'Could not reach http://localhost:3000: fetch failed' });
  });
});
