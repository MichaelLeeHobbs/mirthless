// ===========================================
// Service Error
// ===========================================
// Typed error class for service-layer errors.
// Replaces ad-hoc string matching in controllers with structured error codes.

export const SERVICE_ERRORS = {
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  FORBIDDEN: 'FORBIDDEN',
  SYSTEM_PROTECTED: 'SYSTEM_PROTECTED',
  SELF_ACTION: 'SELF_ACTION',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  CONFLICT: 'CONFLICT',
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

/**
 * Type guard to check if an error is a ServiceError, optionally matching a specific code.
 * Uses duck typing instead of instanceof — stderr-lib's tryCatch reconstructs errors,
 * breaking the prototype chain.
 */
export function isServiceError(error: unknown, code?: ServiceErrorCode): error is ServiceError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Record<string, unknown>;
  if (candidate['name'] !== 'ServiceError' || typeof candidate['code'] !== 'string') return false;
  return code ? candidate['code'] === code : true;
}
