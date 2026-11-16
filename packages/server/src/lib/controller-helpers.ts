// ===========================================
// Controller Error Helpers
// ===========================================
// Shared error-to-HTTP mapping used by all controllers.

import { isServiceError } from './service-error.js';

/** Map a service error to an HTTP status code. */
export function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'CONFLICT')) return 409;
  if (isServiceError(error, 'INVALID_INPUT')) return 400;
  if (isServiceError(error, 'FORBIDDEN')) return 403;
  if (isServiceError(error, 'SYSTEM_PROTECTED')) return 403;
  if (isServiceError(error, 'INVALID_CREDENTIALS')) return 401;
  if (isServiceError(error, 'UNAUTHORIZED')) return 401;
  if (isServiceError(error, 'PASSWORD_CHANGE_REQUIRED')) return 403;
  if (isServiceError(error, 'ACCOUNT_LOCKED')) return 423;
  if (isServiceError(error, 'ACCOUNT_DEACTIVATED')) return 403;
  if (isServiceError(error, 'SELF_ACTION')) return 400;
  if (isServiceError(error, 'NOT_SUPPORTED')) return 422;
  if (isServiceError(error, 'UNAVAILABLE')) return 503;
  if (isServiceError(error, 'AUDIT_UNAVAILABLE')) return 503;
  return 500;
}

/** Build a standard API error response body. */
export function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}
