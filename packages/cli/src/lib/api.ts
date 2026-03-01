// ===========================================
// CLI API Client
// ===========================================
// HTTP client for the Mirthless server API.

/** Configuration for the API client. */
export interface ApiClientConfig {
  readonly baseUrl: string;
  readonly token: string | null;
}

/** Standard API response shape from the Mirthless server. */
export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Thin HTTP client for communicating with the Mirthless server API.
 * Handles auth headers, JSON serialization, and 204 responses.
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

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (response.status === 204) {
      return { success: true };
    }

    return response.json() as Promise<ApiResponse<T>>;
  }
}
