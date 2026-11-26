import { isServiceError } from './service-error.js';

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

/**
 * The error behind each body made here for a 500 (INTERNAL or CONFIG_ERROR), so
 * its request's log line can carry it (#473). Keyed by the body: send it as made.
 */
const internalCauses = new WeakMap<object, { readonly cause: unknown }>();

export function errorResponse(error: unknown): { code: string; message: string } {
  const body = isServiceError(error) ? { code: error.code, message: error.message } : { code: 'INTERNAL', message: 'Internal server error' };
  if (mapErrorToStatus(error) === 500) internalCauses.set(body, { cause: error });
  return body;
}

/** What an `error` body that `errorResponse` made for a 500 was made from. */
export function internalCause(body: unknown): { readonly cause: unknown } | undefined {
  return typeof body === 'object' && body !== null ? internalCauses.get(body) : undefined;
}
