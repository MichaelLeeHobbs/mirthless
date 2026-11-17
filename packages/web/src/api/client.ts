import type { ApiResponse } from '@galvanigraph/core-models';
import { isPlainObject } from '@galvanigraph/core-util';
import { useAuthStore, type AuthUser } from '../stores/auth.store.js';
import { noticeAuditUnavailable } from '../lib/audit-unavailable.js';

const BASE_URL = '/api/v1';

/** What a refresh gives back: the new token and the user as they are now. */
interface RefreshResult {
  readonly accessToken: string;
  /** Null when the answer carries no usable user; the stored one is kept. */
  readonly user: { readonly profile: AuthUser; readonly mustChangePassword: boolean } | null;
}

/** Mutex to prevent concurrent token refresh attempts */
let refreshPromise: Promise<RefreshResult | null> | null = null;

interface FetchOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

/** The user in a refresh answer, or null when it is missing or malformed. */
function readRefreshedUser(value: unknown): RefreshResult['user'] {
  if (!isPlainObject(value)) return null;
  const { id, username, email, role, permissions, mustChangePassword } = value;
  if (typeof id !== 'string' || typeof username !== 'string' || typeof email !== 'string' || typeof role !== 'string') return null;
  if (!Array.isArray(permissions) || !permissions.every((p): p is string => typeof p === 'string')) return null;
  return { profile: { id, username, email, role, permissions }, mustChangePassword: mustChangePassword === true };
}

/** Attempt to refresh the session using the refresh endpoint */
async function refreshSession(): Promise<RefreshResult | null> {
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
    if (!isPlainObject(json) || json['success'] !== true || !isPlainObject(json['data'])) return null;
    const { accessToken, user } = json['data'];
    if (typeof accessToken !== 'string') return null;
    return { accessToken, user: readRefreshedUser(user) };
  } catch {
    return null;
  }
}

/**
 * Store a refreshed session. The refresh carries the user's current role and
 * permissions, so a role change shows in the UI at the next refresh (#219).
 */
function applyRefresh(refreshed: RefreshResult): void {
  const store = useAuthStore.getState();
  if (refreshed.user) {
    store.setAuth(refreshed.user.profile, refreshed.accessToken, refreshed.user.mustChangePassword);
  } else {
    store.setAccessToken(refreshed.accessToken);
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
      refreshPromise = refreshSession().finally(() => {
        refreshPromise = null;
      });
    }

    const refreshed = await refreshPromise;

    if (refreshed) {
      applyRefresh(refreshed);
      response = await makeRequest(refreshed.accessToken);
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
      const errorJson = (await response.json()) as ApiResponse<T>;
      // A body without the usual error object still keeps the server's message.
      if (!errorJson.success) noticeAuditUnavailable((errorJson as { error?: { code?: string } }).error?.code);
      return errorJson;
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

// ----- User API -----

export interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** The held role names joined. */
  readonly role: string;
  /** The role names the user holds; absent from servers before roles were rows. */
  readonly roles?: readonly string[];
  readonly enabled: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface UserDetail extends UserSummary {
  readonly description: string | null;
  readonly failedLoginAttempts: number;
  readonly lockedUntil: string | null;
  readonly updatedAt: string;
}

// ----- Role Types -----

/** A role (GET /roles, roles:read). The admin role is locked and holds every permission. */
export interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly builtIn: boolean;
  readonly admin: boolean;
  readonly permissions: readonly string[];
  /** Users holding the role through a live assignment. */
  readonly holders: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ----- Code Template Types -----

export interface CodeTemplateLibrary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly templateCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CodeTemplateDetail {
  readonly id: string;
  readonly libraryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly language: string;
  readonly code: string;
  readonly contexts: ReadonlyArray<string>;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ----- Alert Types -----

export interface AlertActionDetail {
  readonly id: string;
  readonly actionType: string;
  readonly recipients: ReadonlyArray<string>;
  readonly properties: Record<string, unknown> | null;
}

export interface AlertSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly triggerType: string;
  readonly revision: number;
  readonly channelCount: number;
  readonly actionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AlertDetail extends AlertSummary {
  readonly trigger: {
    readonly type: string;
    readonly errorTypes: ReadonlyArray<string>;
    readonly regex: string | null;
    /** NO_MESSAGES triggers only. */
    readonly windowMinutes: number | null;
  };
  readonly channelIds: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<AlertActionDetail>;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string | null;
  readonly reAlertIntervalMs: number | null;
  readonly maxAlerts: number | null;
}

export interface AlertListResult {
  readonly data: readonly AlertSummary[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

// ----- Event Types -----

export interface EventSummary {
  readonly id: number;
  readonly level: string;
  readonly name: string;
  readonly outcome: string;
  readonly userId: string | null;
  readonly channelId: string | null;
  readonly ipAddress: string | null;
  readonly createdAt: string;
}

export interface EventDetail extends EventSummary {
  readonly serverId: string | null;
  readonly attributes: Record<string, unknown> | null;
}

export interface EventListResult {
  readonly data: readonly EventSummary[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

// ----- Audit Types -----

/** One row of the protected audit log (GET /audit, audit:read). */
export interface AuditEntry {
  readonly id: number;
  readonly occurredAt: string;
  readonly action: string;
  readonly outcome: string;
  readonly userId: string | null;
  readonly channelId: string | null;
  readonly ipAddress: string | null;
  readonly attributes: Record<string, unknown> | null;
}

export interface AuditListResult {
  readonly data: readonly AuditEntry[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

// ----- Setting Types -----

export interface SettingDetail {
  readonly id: string;
  readonly key: string;
  readonly value: string | null;
  readonly type: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ----- Global Scripts Types -----

export interface GlobalScriptsData {
  readonly deploy: string;
  readonly undeploy: string;
  readonly preprocessor: string;
  readonly postprocessor: string;
  /** The language each script is written in; absent from older servers, which read as JavaScript. */
  readonly languages?: Readonly<Record<'deploy' | 'undeploy' | 'preprocessor' | 'postprocessor', string>>;
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
