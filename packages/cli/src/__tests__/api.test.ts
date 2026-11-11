// ===========================================
// API Client Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../lib/api.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('strips trailing slashes from base URL', () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:3000///', token: null });
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      void client.get('/api/test');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/test',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('get', () => {
    it('sends GET request to correct URL', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true, data: { id: '1' } }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      const result = await client.get('/api/v1/channels');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/channels',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual({ success: true, data: { id: '1' } });
    });

    it('includes auth header when token is provided', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: 'my-token' });
      await client.get('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
        }),
      );
    });

    it('omits auth header when token is null', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      await client.get('/test');
      const callHeaders = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBeUndefined();
    });
  });

  describe('post', () => {
    it('sends POST request with JSON body', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      await client.post('/api/v1/auth/login', { username: 'admin', password: 'pass' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'admin', password: 'pass' }),
        }),
      );
    });

    it('sends POST request without body when none provided', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      await client.post('/api/v1/channels/abc/deploy');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' }),
      );
      const callInit = mockFetch.mock.calls[0]![1] as Record<string, unknown>;
      expect(callInit).not.toHaveProperty('body');
    });
  });

  describe('put', () => {
    it('sends PUT request with JSON body', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      await client.put('/api/v1/channels/abc', { name: 'updated' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/channels/abc',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'updated' }),
        }),
      );
    });
  });

  describe('del', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      await client.del('/api/v1/channels/abc');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/channels/abc',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('204 handling', () => {
    it('returns success without parsing body on 204', async () => {
      mockFetch.mockResolvedValue({
        status: 204,
        json: () => { throw new Error('should not be called'); },
      } as unknown as Response);
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      const result = await client.del('/api/v1/channels/abc');
      expect(result).toEqual({ success: true });
    });
  });

  describe('error responses', () => {
    it('returns error response from server', async () => {
      mockFetch.mockResolvedValue(
        makeResponse(400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid input' },
        }),
      );
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      const result = await client.post('/api/v1/auth/login', {});
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toBe('Invalid input');
    });
  });

  describe('content-type header', () => {
    it('always sets Content-Type to application/json', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { success: true }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      await client.get('/test');
      const callHeaders = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(callHeaders['Content-Type']).toBe('application/json');
    });
  });
});

describe('ApiClient failures', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns an error instead of throwing when the server cannot be reached', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));
    const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });

    expect(await client.get('/api/v1/channels')).toEqual({
      success: false,
      error: { code: 'NETWORK', message: 'Could not reach http://localhost:3000: fetch failed' },
    });
  });

  it('returns an error when the response is not JSON, such as a proxy error page', async () => {
    mockFetch.mockResolvedValue({ status: 502, json: () => Promise.reject(new SyntaxError('Unexpected token <')) } as Response);
    const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });

    expect(await client.get('/api/v1/channels')).toEqual({
      success: false,
      error: { code: 'BAD_RESPONSE', message: 'The server answered HTTP 502 with something other than JSON' },
    });
  });

  it('gives every request a timeout', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: () => Promise.resolve({ success: true }) } as Response);
    const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
    await client.get('/x');

    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('says so when the request times out', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });

    const result = await client.get('/x');
    expect(result.error?.message).toBe('Could not reach http://localhost:3000: no answer within 30 seconds');
  });

  describe('expired session', () => {
    it('tells the user to log in again when a signed-in request is refused', async () => {
      mockFetch.mockResolvedValue(makeResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));
      const client = new ApiClient({ baseUrl: 'http://localhost:3000', token: 'old' });
      const result = await client.get('/api/v1/channels');
      expect(result.error?.code).toBe('SESSION_EXPIRED');
      expect(result.error?.message).toContain('galvaniflow login');
    });

    it('passes a failed login through unchanged', async () => {
      const body = { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } };
      mockFetch.mockResolvedValue(makeResponse(401, body));
      const withToken = new ApiClient({ baseUrl: 'http://localhost:3000', token: 'old' });
      const noToken = new ApiClient({ baseUrl: 'http://localhost:3000', token: null });
      expect(await withToken.post('/api/v1/auth/login', {})).toEqual(body);
      expect(await noToken.get('/api/v1/channels')).toEqual(body);
    });
  });
});
