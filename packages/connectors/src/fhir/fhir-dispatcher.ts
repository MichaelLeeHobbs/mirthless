// ===========================================
// FHIR R4 Dispatcher (Destination Connector)
// ===========================================
// Sends messages as FHIR resources to a FHIR R4 server.
// Uses native fetch for HTTP communication.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';

// ----- Auth Types -----

const FHIR_AUTH_TYPE = {
  NONE: 'NONE',
  BASIC: 'BASIC',
  BEARER: 'BEARER',
  API_KEY: 'API_KEY',
} as const;
type FhirAuthType = typeof FHIR_AUTH_TYPE[keyof typeof FHIR_AUTH_TYPE];

export { FHIR_AUTH_TYPE };
export type { FhirAuthType };

// ----- Config -----

export interface FhirAuthConfig {
  readonly username?: string | undefined;
  readonly password?: string | undefined;
  readonly token?: string | undefined;
  readonly headerName?: string | undefined;
  readonly apiKey?: string | undefined;
}

export interface FhirDispatcherConfig {
  readonly baseUrl: string;
  readonly resourceType: string;
  readonly method: 'POST' | 'PUT';
  readonly authType: FhirAuthType;
  readonly authConfig: FhirAuthConfig;
  readonly format: 'json' | 'xml';
  readonly timeout: number;
  readonly headers: Readonly<Record<string, string>>;
}

// ----- Dispatcher -----

export class FhirDispatcher implements DestinationConnectorRuntime {
  private readonly config: FhirDispatcherConfig;
  private started = false;

  constructor(config: FhirDispatcherConfig) {
    this.config = config;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.baseUrl) throw new Error('FHIR base URL is required');
      try {
        new URL(this.config.baseUrl);
      } catch {
        throw new Error(`Invalid base URL: ${this.config.baseUrl}`);
      }
      if (!this.config.resourceType) throw new Error('FHIR resource type is required');
      validateAuth(this.config.authType, this.config.authConfig);
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = true;
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) throw new Error('Dispatcher not started');
      if (signal.aborted) throw new Error('Send aborted');

      const url = buildFhirUrl(this.config.baseUrl, this.config.resourceType);
      const headers = buildHeaders(this.config);

      const timeoutSignal = AbortSignal.timeout(this.config.timeout);
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

      const response = await fetch(url, {
        method: this.config.method,
        headers,
        body: message.content,
        signal: combinedSignal,
      });

      const responseBody = await response.text();

      if (response.ok) {
        return { status: 'SENT' as const, content: responseBody };
      }
      return {
        status: 'ERROR' as const,
        content: responseBody,
        errorMessage: `FHIR ${String(response.status)}: ${response.statusText}`,
      };
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }
}

// ----- Helpers -----

/** Build FHIR endpoint URL. */
export function buildFhirUrl(baseUrl: string, resourceType: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/${resourceType}`;
}

/** Build HTTP headers including auth and content type. */
export function buildHeaders(config: FhirDispatcherConfig): Record<string, string> {
  const contentType = config.format === 'json'
    ? 'application/fhir+json'
    : 'application/fhir+xml';

  const accept = config.format === 'json'
    ? 'application/fhir+json'
    : 'application/fhir+xml';

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Accept': accept,
    ...config.headers,
  };

  const auth = config.authConfig;
  switch (config.authType) {
    case FHIR_AUTH_TYPE.BASIC:
      if (auth.username && auth.password) {
        headers['Authorization'] = `Basic ${btoa(`${auth.username}:${auth.password}`)}`;
      }
      break;
    case FHIR_AUTH_TYPE.BEARER:
      if (auth.token) {
        headers['Authorization'] = `Bearer ${auth.token}`;
      }
      break;
    case FHIR_AUTH_TYPE.API_KEY:
      if (auth.headerName && auth.apiKey) {
        headers[auth.headerName] = auth.apiKey;
      }
      break;
    case FHIR_AUTH_TYPE.NONE:
      break;
  }

  return headers;
}

/** Validate auth config based on auth type. */
function validateAuth(authType: FhirAuthType, authConfig: FhirAuthConfig): void {
  switch (authType) {
    case FHIR_AUTH_TYPE.BASIC:
      if (!authConfig.username || !authConfig.password) {
        throw new Error('Basic auth requires username and password');
      }
      break;
    case FHIR_AUTH_TYPE.BEARER:
      if (!authConfig.token) {
        throw new Error('Bearer auth requires a token');
      }
      break;
    case FHIR_AUTH_TYPE.API_KEY:
      if (!authConfig.headerName || !authConfig.apiKey) {
        throw new Error('API key auth requires headerName and apiKey');
      }
      break;
    case FHIR_AUTH_TYPE.NONE:
      break;
  }
}
