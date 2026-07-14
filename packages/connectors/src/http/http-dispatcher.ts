// ===========================================
// HTTP Dispatcher (Destination Connector)
// ===========================================
// Sends messages to a remote HTTP endpoint. Plain HTTP (and HTTPS with no
// custom TLS material) goes through global fetch. HTTPS with custom TLS
// options (a trusted CA, a client certificate for mTLS, or a relaxed
// rejectUnauthorized) goes through node:https.request, which accepts ca/cert/
// key/rejectUnauthorized directly — global fetch cannot apply per-request TLS
// options without an undici Agent, and undici is not a dependency here.

import * as https from 'node:https';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import type { TlsClientOptions } from '../tls.js';

// ----- Config -----

export interface HttpDispatcherConfig {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly contentType: string;
  readonly responseTimeout: number;
  /**
   * Optional client-side TLS material for HTTPS destinations: a custom/internal
   * CA to trust, a client certificate + key for mutual TLS, and verification
   * control. Applied only for https:// URLs. Verification defaults to ON.
   */
  readonly tls?: TlsClientOptions | undefined;
}

/**
 * True when the TLS config carries material that global fetch cannot honor:
 * a custom CA, a client cert/key (mTLS), or an explicit rejectUnauthorized:false.
 * Empty/absent values fall back to fetch so existing behavior is unchanged.
 */
function hasActiveTlsOptions(tls: TlsClientOptions | undefined): boolean {
  if (!tls) return false;
  return Boolean(tls.ca) || Boolean(tls.cert) || Boolean(tls.key) || tls.rejectUnauthorized === false;
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

      // fetch() throws a TypeError if a body is supplied with GET/HEAD, so only
      // attach the body for methods that accept one.
      const methodUpper = this.config.method.toUpperCase();
      const bodyAllowed = methodUpper !== 'GET' && methodUpper !== 'HEAD';

      // HTTPS with custom TLS material can't go through fetch (needs an undici
      // Agent we don't depend on) — use node:https so ca/cert/key/reject apply.
      const isHttps = new URL(this.config.url).protocol === 'https:';
      if (isHttps && hasActiveTlsOptions(this.config.tls)) {
        return this.sendViaHttps(message, combinedSignal, bodyAllowed);
      }

      const response = await fetch(this.config.url, {
        method: this.config.method,
        headers: {
          'Content-Type': this.config.contentType,
          ...this.config.headers,
        },
        ...(bodyAllowed ? { body: message.content } : {}),
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

  /**
   * Send over node:https, applying client TLS options. Mirrors the fetch path's
   * behavior: same headers, body only when allowed, abort via signal, and the
   * same {status, content, errorMessage} result shape (2xx => SENT).
   */
  private sendViaHttps(
    message: ConnectorMessage,
    signal: AbortSignal,
    bodyAllowed: boolean,
  ): Promise<ConnectorResponse> {
    const tls = this.config.tls;
    return new Promise<ConnectorResponse>((resolve, reject) => {
      const req = https.request(
        this.config.url,
        {
          method: this.config.method,
          headers: {
            'Content-Type': this.config.contentType,
            ...this.config.headers,
          },
          signal,
          rejectUnauthorized: tls?.rejectUnauthorized !== false,
          ...(tls?.ca ? { ca: tls.ca } : {}),
          ...(tls?.cert ? { cert: tls.cert } : {}),
          ...(tls?.key ? { key: tls.key } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks).toString('utf-8');
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              resolve({ status: 'SENT', content: responseBody });
              return;
            }
            resolve({
              status: 'ERROR',
              content: responseBody,
              errorMessage: `HTTP ${String(status)}`,
            });
          });
          res.on('error', reject);
        },
      );

      // TLS verification failures, connection resets, and aborts all surface here
      // and reject the promise, so a failed send never masquerades as SENT.
      req.on('error', reject);
      if (bodyAllowed) {
        req.write(message.content);
      }
      req.end();
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
