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
