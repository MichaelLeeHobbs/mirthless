import { describe, it, expect } from 'vitest';
import { errorResponse, mapErrorToStatus } from '../controller-helpers.js';
import { ServiceError } from '../service-error.js';

describe('mapErrorToStatus', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['ALREADY_EXISTS', 409],
    ['CONFLICT', 409],
    ['INVALID_INPUT', 400],
    ['FORBIDDEN', 403],
    ['SYSTEM_PROTECTED', 403],
    ['INVALID_CREDENTIALS', 401],
    ['ACCOUNT_LOCKED', 423],
    ['ACCOUNT_DEACTIVATED', 403],
    ['SELF_ACTION', 400],
    ['NOT_SUPPORTED', 422],
  ] as const)('maps %s to %i', (code, status) => {
    expect(mapErrorToStatus(new ServiceError(code, 'x'))).toBe(status);
  });

  it('maps any other service code, and a plain error, to 500', () => {
    expect(mapErrorToStatus(new ServiceError('CONFIG_ERROR', 'x'))).toBe(500);
    expect(mapErrorToStatus(new Error('boom'))).toBe(500);
    expect(mapErrorToStatus('boom')).toBe(500);
  });
});

describe('errorResponse', () => {
  it('passes a service error code and message through', () => {
    expect(errorResponse(new ServiceError('NOT_FOUND', 'Channel not found'))).toEqual({ code: 'NOT_FOUND', message: 'Channel not found' });
  });

  it('hides anything else behind INTERNAL', () => {
    expect(errorResponse(new Error('password=hunter2 at db'))).toEqual({ code: 'INTERNAL', message: 'Internal server error' });
  });
});
