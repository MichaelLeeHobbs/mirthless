import { ALL_CHANNELS, type ApiResponse, type GrantEntry } from '@galvanigraph/core-models';
import { isPlainObject } from '@galvanigraph/core-util';
import { useAuthStore, type AuthUser } from '../stores/auth.store.js';
import { noticeAuditUnavailable } from '../lib/audit-unavailable.js';

const BASE_URL = '/api/v1';

interface RefreshResult {
  readonly accessToken: string;
  /** Null when the answer carries no usable user; the stored one is kept. */
  readonly user: { readonly profile: AuthUser; readonly mustChangePassword: boolean } | null;
}

let refreshPromise: Promise<RefreshResult | null> | null = null;

interface FetchOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

/**
 * Undefined when absent or malformed: the UI then treats permissions as
 * unscoped, and the server still judges each request (D-310).
 */
export function readGrants(value: unknown): GrantEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const grants: GrantEntry[] = [];
  for (const g of value) {
    if (!isPlainObject(g) || typeof g['permission'] !== 'string') return undefined;
    const scope = g['scope'];
    const ok = scope === ALL_CHANNELS || (Array.isArray(scope) && scope.every((id) => typeof id === 'string'));
    if (!ok) return undefined;
    grants.push({ permission: g['permission'], scope } as GrantEntry);
  }
  return grants;
}

export function readRefreshedUser(value: unknown): RefreshResult['user'] {
  if (!isPlainObject(value)) return null;
  const { id, username, email, role, permissions, mustChangePassword } = value;
  if (typeof id !== 'string' || typeof username !== 'string' || typeof email !== 'string' || typeof role !== 'string') return null;
  if (!Array.isArray(permissions) || !permissions.every((p): p is string => typeof p === 'string')) return null;
  const grants = readGrants(value['grants']);
  const next = value['nextExpiryAt'];
  const nextExpiryAt = typeof next === 'string' && !Number.isNaN(Date.parse(next)) ? next : null;
  return {
    profile: { id, username, email, role, permissions, nextExpiryAt, ...(grants === undefined ? {} : { grants }) },
    mustChangePassword: mustChangePassword === true,
  };
}

/** Falls back to the flat permissions for a server that sends no grants. */
export function accessKey(user: AuthUser | null): string {
  if (!user) return '';
  const grants = user.grants?.map((g) => `${g.permission}=${g.scope === ALL_CHANNELS ? ALL_CHANNELS : [...g.scope].sort().join(',')}`).sort();
  return JSON.stringify(grants ?? [...user.permissions].sort());
}

/**
 * A refresh rotates the session, so another caller still holding the old token
 * (a socket mid-handshake) comes here too rather than signing out on the spot.
 */
export async function refreshOrSignOut(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => { refreshPromise = null; });
  }
  const refreshed = await refreshPromise;
  if (refreshed) {
    applyRefresh(refreshed);
    return refreshed.accessToken;
  }
  useAuthStore.getState().clearAuth();
  return null;
}

/** The routes that answer 404 outside the caller's access. */
export function isChannelPath(path: string): boolean {
  return /^\/channels\/[0-9a-f-]{36}(\/|\?|$)/i.test(path);
}

/** At most one access check every 30 seconds, so a page of refused requests refreshes once. */
const ACCESS_CHECK_INTERVAL_MS = 30_000;
let lastAccessCheck = 0;

/** For tests. */
export function resetAccessCheck(): void {
  lastAccessCheck = 0;
}

/**
 * A 403 or 404 from a scoped route may mean the record is now outside the
 * caller's access rather than deleted; the layout then says "Your access
 * changed" so nobody recreates a channel they merely lost (D-310).
 */
export async function checkAccess(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastAccessCheck < ACCESS_CHECK_INTERVAL_MS) return;
  lastAccessCheck = now;
  const before = accessKey(useAuthStore.getState().user);
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => { refreshPromise = null; });
  }
  const refreshed = await refreshPromise;
  if (!refreshed?.user) return;
  applyRefresh(refreshed);
  if (accessKey(refreshed.user.profile) !== before) useAuthStore.getState().setAccessChanged(new Date().toISOString());
}

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

/** The refresh carries the user's current role and permissions, so a role change shows at the next refresh (#219). */
function applyRefresh(refreshed: RefreshResult): void {
  const store = useAuthStore.getState();
  if (refreshed.user) {
    store.setAuth(refreshed.user.profile, refreshed.accessToken, refreshed.user.mustChangePassword);
  } else {
    store.setAccessToken(refreshed.accessToken);
  }
}

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

  if (response.status === 401 && token) {
    // A refresh that finished while this request was in flight rotated the session
    // and stored a new token: try that first rather than rotating again.
    const current = useAuthStore.getState().accessToken;
    if (current && current !== token) {
      response = await makeRequest(current);
    }
  }

  if (response.status === 401 && token) {
    const refreshedToken = await refreshOrSignOut();

    if (refreshedToken) {
      response = await makeRequest(refreshedToken);
    } else {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Session expired. Please log in again.' },
      };
    }
  }

  if (!response.ok && response.status !== 401) {
    // A channel outside the caller's access answers 404, so a missing channel may be
    // access that changed; check in the background. Only for a channel route: a 403
    // for a permission the user never held is not news, and every refresh rotates
    // the session, which a page leaving mid-refresh can turn into a sign-out.
    if (response.status === 404 && token && isChannelPath(path)) void checkAccess();
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

  // 204 No Content has no body.
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

/** The admin role is locked and holds every permission. */
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

export interface CodeTemplateLibrary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly templateCount: number;
  /** The channels whose scripts get the library's templates, as far as the reader may see; null: every channel. */
  readonly channelIds?: readonly string[] | null;
  /** Links outside the reader's access, left out of `channelIds`. */
  readonly outsideScopeCount?: number;
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

export interface GlobalScriptsData {
  readonly deploy: string;
  readonly undeploy: string;
  readonly preprocessor: string;
  readonly postprocessor: string;
  /** The language each script is written in; absent from older servers, which read as JavaScript. */
  readonly languages?: Readonly<Record<'deploy' | 'undeploy' | 'preprocessor' | 'postprocessor', string>>;
}

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
