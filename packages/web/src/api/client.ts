import type { ApiResponse } from '@mirthless/core-models';
import { useAuthStore } from '../stores/auth.store.js';

const BASE_URL = '/api/v1';

/** Mutex to prevent concurrent token refresh attempts */
let refreshPromise: Promise<string | null> | null = null;

interface FetchOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

/** Attempt to refresh the access token using the refresh endpoint */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!response.ok) {
      return null;
    }

    const json: unknown = await response.json();
    if (
      typeof json === 'object' &&
      json !== null &&
      'success' in json &&
      (json as { success: boolean }).success &&
      'data' in json
    ) {
      const data = (json as { data: unknown }).data;
      if (typeof data === 'object' && data !== null && 'accessToken' in data) {
        return (data as { accessToken: string }).accessToken;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Core fetch wrapper for the API.
 * Attaches Bearer token, handles 401 with token refresh (mutex pattern),
 * and parses the standard ApiResponse JSON format.
 */
export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers = {}, signal } = options;

  const makeRequest = async (token: string | null): Promise<Response> => {
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    const init: RequestInit = {
      method,
      headers: requestHeaders,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    if (signal) {
      init.signal = signal;
    }

    return fetch(`${BASE_URL}${path}`, init);
  };

  const token = useAuthStore.getState().accessToken;
  let response = await makeRequest(token);

  // Handle 401 — attempt token refresh with mutex
  if (response.status === 401 && token) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;

    if (newToken) {
      useAuthStore.getState().setAccessToken(newToken);
      response = await makeRequest(newToken);
    } else {
      useAuthStore.getState().clearAuth();
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Session expired. Please log in again.' },
      };
    }
  }

  if (!response.ok && response.status !== 401) {
    try {
      const errorJson: unknown = await response.json();
      return errorJson as ApiResponse<T>;
    } catch {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: `Request failed with status ${String(response.status)}`,
        },
      };
    }
  }

  // 204 No Content has no body — return a synthetic success
  if (response.status === 204) {
    return { success: true, data: undefined as T };
  }

  try {
    const json: unknown = await response.json();
    return json as ApiResponse<T>;
  } catch {
    return {
      success: false,
      error: { code: 'PARSE_ERROR', message: 'Failed to parse server response' },
    };
  }
}

/** Convenience methods for common HTTP verbs */
export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<ApiResponse<T>> =>
    apiFetch<T>(path, signal ? { signal } : {}),

  post: <T>(path: string, body: unknown, signal?: AbortSignal): Promise<ApiResponse<T>> =>
    apiFetch<T>(path, signal ? { method: 'POST', body, signal } : { method: 'POST', body }),

  put: <T>(path: string, body: unknown, signal?: AbortSignal): Promise<ApiResponse<T>> =>
    apiFetch<T>(path, signal ? { method: 'PUT', body, signal } : { method: 'PUT', body }),

  patch: <T>(path: string, body: unknown, signal?: AbortSignal): Promise<ApiResponse<T>> =>
    apiFetch<T>(path, signal ? { method: 'PATCH', body, signal } : { method: 'PATCH', body }),

  delete: <T>(path: string, signal?: AbortSignal): Promise<ApiResponse<T>> =>
    apiFetch<T>(path, signal ? { method: 'DELETE', signal } : { method: 'DELETE' }),
} as const;
