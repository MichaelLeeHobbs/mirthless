// ===========================================
// CLI API Client
// ===========================================
// HTTP client for the GalvaniFlow server API.

/** Every request gives up after this long. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Configuration for the API client. */
export interface ApiClientConfig {
  readonly baseUrl: string;
  readonly token: string | null;
}

/** Standard API response shape from the GalvaniFlow server. */
export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Thin HTTP client for communicating with the GalvaniFlow server API.
 * Handles auth headers, JSON serialization, and 204 responses. Never throws:
 * a network failure, a timeout or a non-JSON answer comes back as an error response.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string | null;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
  }

  /** Send a GET request. */
  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  /** Send a POST request with optional JSON body. */
  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  /** Send a PUT request with optional JSON body. */
  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  /** Send a DELETE request. */
  async del<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      return { success: false, error: { code: 'NETWORK', message: `Could not reach ${this.baseUrl}: ${describe(error)}` } };
    }

    if (response.status === 204) {
      return { success: true };
    }

    // A session lasts 15 minutes. Say what to do, not just "Unauthorized".
    if (response.status === 401 && this.token && !path.includes('/auth/')) {
      return {
        success: false,
        error: { code: 'SESSION_EXPIRED', message: 'Your session has expired or is not valid. Run "galvaniflow login" and try again.' },
      };
    }

    try {
      return await (response.json() as Promise<ApiResponse<T>>);
    } catch {
      return {
        success: false,
        error: { code: 'BAD_RESPONSE', message: `The server answered HTTP ${String(response.status)} with something other than JSON` },
      };
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no answer within ${String(REQUEST_TIMEOUT_MS / 1_000)} seconds`;
  }
  return error instanceof Error ? error.message : String(error);
}
