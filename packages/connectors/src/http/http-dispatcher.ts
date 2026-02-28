// ===========================================
// HTTP Dispatcher (Destination Connector)
// ===========================================
// Sends messages to a remote HTTP endpoint using fetch.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';

// ----- Config -----

export interface HttpDispatcherConfig {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly contentType: string;
  readonly responseTimeout: number;
}

// ----- Dispatcher -----

export class HttpDispatcher implements DestinationConnectorRuntime {
  private readonly config: HttpDispatcherConfig;
  private started = false;

  constructor(config: HttpDispatcherConfig) {
    this.config = config;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.url) {
        throw new Error('URL is required');
      }
      try {
        new URL(this.config.url);
      } catch {
        throw new Error(`Invalid URL: ${this.config.url}`);
      }
      const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      if (!validMethods.includes(this.config.method.toUpperCase())) {
        throw new Error(`Invalid method: ${this.config.method}`);
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = true;
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) {
        throw new Error('Dispatcher not started');
      }
      if (signal.aborted) {
        throw new Error('Send aborted');
      }

      const timeoutSignal = AbortSignal.timeout(this.config.responseTimeout);
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

      const response = await fetch(this.config.url, {
        method: this.config.method,
        headers: {
          'Content-Type': this.config.contentType,
          ...this.config.headers,
        },
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
        errorMessage: `HTTP ${String(response.status)}`,
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
