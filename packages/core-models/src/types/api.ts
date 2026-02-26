// ===========================================
// API Response Types
// ===========================================
// Shared types for API request/response format.

/** Standard success response */
export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
}

/** Standard error response */
export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  readonly success: true;
  readonly data: ReadonlyArray<T>;
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
