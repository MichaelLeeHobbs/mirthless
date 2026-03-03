// ===========================================
// Metrics Middleware Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ----- Hoisted Mocks -----

const { mockObserve, mockInc } = vi.hoisted(() => ({
  mockObserve: vi.fn(),
  mockInc: vi.fn(),
}));

vi.mock('../../lib/metrics.js', () => ({
  httpRequestDuration: { observe: mockObserve },
  httpRequestTotal: { inc: mockInc },
}));

// ----- Import after mocks -----

import { metricsMiddleware, normalizePath } from '../metrics.middleware.js';
import type { Request, Response } from 'express';

// ----- Helpers -----

interface MockRequest {
  path: string;
  method: string;
  baseUrl: string;
  route?: { path: string };
}

function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    path: '/api/v1/channels',
    method: 'GET',
    baseUrl: '',
    ...overrides,
  };
}

function createMockResponse(): Response & EventEmitter {
  const emitter = new EventEmitter();
  const res = emitter as unknown as Response & EventEmitter;
  (res as unknown as { statusCode: number }).statusCode = 200;
  return res;
}

// ----- Tests -----

describe('metricsMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() for normal requests', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('records duration and count after response finishes', () => {
    const req = createMockRequest({ method: 'POST', path: '/api/v1/channels' });
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    expect(mockObserve).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();

    // Simulate response finish
    res.emit('finish');

    expect(mockObserve).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);

    const observeArgs = mockObserve.mock.calls[0]!;
    expect(observeArgs[0]).toEqual({
      method: 'POST',
      route: '/api/v1/channels',
      status_code: '200',
    });
    // Duration should be a non-negative number
    expect(typeof observeArgs[1]).toBe('number');
    expect(observeArgs[1]).toBeGreaterThanOrEqual(0);

    expect(mockInc).toHaveBeenCalledWith({
      method: 'POST',
      route: '/api/v1/channels',
      status_code: '200',
    });
  });

  it('uses route path with baseUrl when req.route is present', () => {
    const req = createMockRequest({
      method: 'GET',
      path: '/api/v1/channels/550e8400-e29b-41d4-a716-446655440000',
      baseUrl: '/api/v1',
      route: { path: '/channels/:id' },
    });
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    expect(mockObserve).toHaveBeenCalledTimes(1);
    const labels = mockObserve.mock.calls[0]![0] as Record<string, string>;
    expect(labels['route']).toBe('/api/v1/channels/:id');
  });

  it('normalizes UUIDs in path when req.route is absent', () => {
    const req = createMockRequest({
      method: 'GET',
      path: '/api/v1/channels/550e8400-e29b-41d4-a716-446655440000',
    });
    // Do not set req.route
    delete (req as Partial<MockRequest>).route;
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    const labels = mockObserve.mock.calls[0]![0] as Record<string, string>;
    expect(labels['route']).toBe('/api/v1/channels/:id');
  });

  it('includes correct status_code label', () => {
    const req = createMockRequest({ method: 'POST' });
    const res = createMockResponse();
    (res as unknown as { statusCode: number }).statusCode = 404;
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    const labels = mockObserve.mock.calls[0]![0] as Record<string, string>;
    expect(labels['status_code']).toBe('404');
  });

  // ----- Skip paths -----

  it('skips recording for /health', () => {
    const req = createMockRequest({ path: '/health' });
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockObserve).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  it('skips recording for /health/live', () => {
    const req = createMockRequest({ path: '/health/live' });
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockObserve).not.toHaveBeenCalled();
  });

  it('skips recording for /health/ready', () => {
    const req = createMockRequest({ path: '/health/ready' });
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockObserve).not.toHaveBeenCalled();
  });

  it('skips recording for /metrics', () => {
    const req = createMockRequest({ path: '/metrics' });
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockObserve).not.toHaveBeenCalled();
  });

  it('does NOT skip recording for other paths', () => {
    const req = createMockRequest({ path: '/api/v1/users' });
    const res = createMockResponse();
    const next = vi.fn();

    metricsMiddleware(req as unknown as Request, res, next);
    res.emit('finish');

    expect(mockObserve).toHaveBeenCalledTimes(1);
  });
});

// ----- normalizePath -----

describe('normalizePath', () => {
  it('replaces a single UUID with :id', () => {
    const result = normalizePath('/api/v1/channels/550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe('/api/v1/channels/:id');
  });

  it('replaces multiple UUIDs in the same path', () => {
    const result = normalizePath(
      '/api/v1/channels/550e8400-e29b-41d4-a716-446655440000/messages/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    expect(result).toBe('/api/v1/channels/:id/messages/:id');
  });

  it('leaves paths without UUIDs unchanged', () => {
    const result = normalizePath('/api/v1/channels');
    expect(result).toBe('/api/v1/channels');
  });

  it('handles path with only a UUID', () => {
    const result = normalizePath('/550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe('/:id');
  });

  it('handles empty string', () => {
    const result = normalizePath('');
    expect(result).toBe('');
  });

  it('handles uppercase hex in UUIDs', () => {
    const result = normalizePath('/api/v1/channels/550E8400-E29B-41D4-A716-446655440000');
    expect(result).toBe('/api/v1/channels/:id');
  });

  it('does not replace partial UUID-like strings', () => {
    // Only 7 chars in first group (should be 8)
    const result = normalizePath('/api/v1/channels/50e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe('/api/v1/channels/50e8400-e29b-41d4-a716-446655440000');
  });
});
