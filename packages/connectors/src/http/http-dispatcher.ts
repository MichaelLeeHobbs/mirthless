// Global fetch cannot apply per-request TLS options without an undici Agent (not a
// dependency), so HTTPS with custom TLS material goes through node:https.

import * as https from 'node:https';
import { tryCatch, type Result } from '@galvanigraph/core-util';
import { fillVariables, variableNames, type DestinationConnectorRuntime, type ConnectorMessage, type ConnectorResponse } from '../base.js';
import { redirectMessage } from '../redirect.js';
import { refuseUrlCredentials } from '../url-credentials.js';
import type { TlsClientOptions } from '../tls.js';

export interface HttpDispatcherConfig {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly contentType: string;
  readonly responseTimeout: number;
  /** Values, the URL and header values may hold `${name}` message variables. */
  readonly parameters?: Readonly<Record<string, string>> | undefined;
  readonly basicAuth?: { readonly username: string; readonly password: string } | undefined;
  /** 'HTTPS' always takes the node:https path so the TLS options apply; absent, the URL decides. */
  readonly scheme?: string | undefined;
  /** Applied only to HTTPS. Verification defaults to on. */
  readonly tls?: TlsClientOptions | undefined;
}

interface OutboundRequest {
  readonly url: URL;
  readonly headers: Record<string, string>;
}

function hasActiveTlsOptions(tls: TlsClientOptions | undefined): boolean {
  if (!tls) return false;
  return Boolean(tls.ca) || Boolean(tls.cert) || Boolean(tls.key) || tls.rejectUnauthorized === false;
}

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
      // A URL that names message variables is checked per message instead.
      if (!this.config.url.includes('${')) {
        // Not quoted in the error: it may hold credentials.
        if (!URL.canParse(this.config.url)) throw new Error('Invalid URL');
        const url = new URL(this.config.url);
        if (!this.usesNodeHttps(url)) refuseUrlCredentials(url);
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

  variablesUsed(): readonly string[] {
    return variableNames([this.config.url, ...Object.values(this.config.parameters ?? {}), ...Object.values(this.config.headers)]);
  }

  /** With no scheme, an https URL takes node:https only when it has custom TLS material. */
  private usesNodeHttps(url: URL): boolean {
    const schemeHttps = this.config.scheme === 'HTTPS';
    return schemeHttps || (url.protocol === 'https:' && hasActiveTlsOptions(this.config.tls));
  }

  /** Holds the credentials: never log it. */
  private requestFor(message: ConnectorMessage): OutboundRequest {
    const url = new URL(fillVariables(this.config.url, message));
    for (const [name, value] of Object.entries(this.config.parameters ?? {})) {
      url.searchParams.append(name, fillVariables(value, message));
    }
    const headers: Record<string, string> = { 'Content-Type': this.config.contentType };
    for (const [name, value] of Object.entries(this.config.headers)) headers[name] = fillVariables(value, message);
    const auth = this.config.basicAuth;
    if (auth) headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    return { url, headers };
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

      // fetch() throws a TypeError for a body with GET/HEAD.
      const methodUpper = this.config.method.toUpperCase();
      const bodyAllowed = methodUpper !== 'GET' && methodUpper !== 'HEAD';

      const request = this.requestFor(message);
      if (this.usesNodeHttps(request.url)) return this.sendViaHttps(message, request, combinedSignal, bodyAllowed);
      refuseUrlCredentials(request.url);

      const response = await fetch(request.url, {
        method: this.config.method,
        headers: request.headers,
        ...(bodyAllowed ? { body: message.content } : {}),
        signal: combinedSignal,
        // Never follow a redirect: fetch re-sends a POST as a body-less GET, the landing
        // page (often a login form) answers 200, and a message that went nowhere reads as SENT.
        redirect: 'manual',
      });

      const responseBody = await response.text();

      if (response.status >= 300 && response.status < 400) {
        return {
          status: 'ERROR' as const,
          content: responseBody,
          errorMessage: redirectMessage(response.status, response.headers.get('location')),
        };
      }
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

  /** Must match the fetch path: same headers, body rule, abort and result shape. */
  private sendViaHttps(
    message: ConnectorMessage,
    request: OutboundRequest,
    signal: AbortSignal,
    bodyAllowed: boolean,
  ): Promise<ConnectorResponse> {
    const tls = this.config.tls;
    return new Promise<ConnectorResponse>((resolve, reject) => {
      const req = https.request(
        request.url,
        {
          method: this.config.method,
          headers: request.headers,
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
            if (status >= 300 && status < 400) {
              const location = res.headers.location;
              resolve({ status: 'ERROR', content: responseBody, errorMessage: redirectMessage(status, location ?? null) });
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
