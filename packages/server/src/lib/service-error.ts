import type { Result } from 'stderr-lib';

export const SERVICE_ERRORS = {
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  /** No credential, or one the server does not accept. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  SYSTEM_PROTECTED: 'SYSTEM_PROTECTED',
  SELF_ACTION: 'SELF_ACTION',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  CONFLICT: 'CONFLICT',
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  CONFIG_ERROR: 'CONFIG_ERROR',
  /** A dependency is busy or failed for now; the same request can succeed later. */
  UNAVAILABLE: 'UNAVAILABLE',
  /** The audit log could not record a fail-closed read, so it was refused (D-312). */
  AUDIT_UNAVAILABLE: 'AUDIT_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ServiceErrorCode = (typeof SERVICE_ERRORS)[keyof typeof SERVICE_ERRORS];

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/** Duck-typed, not instanceof: stderr-lib's tryCatch reconstructs errors, breaking the prototype chain. */
export function isServiceError(error: unknown, code?: ServiceErrorCode): error is ServiceError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Record<string, unknown>;
  if (candidate['name'] !== 'ServiceError' || typeof candidate['code'] !== 'string') return false;
  return code ? candidate['code'] === code : true;
}

/** Null only when the row does not exist. Any other failed read is thrown: taken as missing, it would be exported as absent or overwritten (#323). */
export function foundOrThrow<T>(result: Result<T>): T | null {
  if (result.ok) return result.value;
  if (isServiceError(result.error, 'NOT_FOUND')) return null;
  throw result.error;
}
