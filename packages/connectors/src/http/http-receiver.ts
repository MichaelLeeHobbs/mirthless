// ===========================================
// HTTP Receiver (Source Connector)
// ===========================================
// Listens for inbound HTTP(S) requests and dispatches messages to the engine
// pipeline. Returns an error status when the pipeline fails (never a false
// 200), bounds the request body (DoS guard), and supports optional auth.

import * as http from 'node:http';
import * as https from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import type { TlsServerOptions } from '../tls.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

/**
 * Constant-time string comparison for credentials. Comparing SHA-256 digests keeps
 * the comparison fixed-length (so neither the value nor its length leaks via timing)
 * and satisfies timingSafeEqual's equal-length requirement.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

// ----- Config -----

/** Optional inbound authentication guard. */
export interface HttpAuthConfig {
  readonly type: 'BASIC' | 'TOKEN';
  /** BASIC: expected username. */
  readonly username?: string | undefined;
  /** BASIC: expected password. */
  readonly password?: string | undefined;
  /** TOKEN: expected bearer token. */
  readonly token?: string | undefined;
}

/** Default cap on request body size (bytes) — DoS guard. */
export const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024;

export interface HttpReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly method: string;
  readonly responseContentType: string;
  readonly responseStatusCode: number;
  /** Status returned when the pipeline dispatch fails. Default 500. */
  readonly errorStatusCode: number;
  /** Maximum accepted request body size in bytes. */
  readonly maxBodyBytes: number;
  /** Optional authentication guard (default: none). */
  readonly auth?: HttpAuthConfig | undefined;
  /** Optional TLS. When present the server speaks HTTPS. */
  readonly tls?: TlsServerOptions | undefined;
}

/** Sentinel raised when a request body exceeds the configured cap. */
class BodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds maximum size');
    this.name = 'BodyTooLargeError';
  }
}

// ----- Receiver -----

export class HttpReceiver implements SourceConnectorRuntime {
  private readonly config: HttpReceiverConfig;
  private readonly logger: ConnectorLogger;
  private server: http.Server | null = null;
  private dispatcher: MessageDispatcher | null = null;

  constructor(config: HttpReceiverConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('HTTP');
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.port || this.config.port < 1 || this.config.port > 65535) {
        throw new Error(`Invalid port: ${String(this.config.port)}`);
      }
      const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      if (!validMethods.includes(this.config.method.toUpperCase())) {
        throw new Error(`Invalid method: ${this.config.method}`);
      }
      if (this.config.tls && (!this.config.tls.cert || !this.config.tls.key)) {
        throw new Error('TLS requires both cert and key');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
        void this.handleRequest(req, res);
      };
      this.server = this.config.tls
        ? https.createServer(
          {
            cert: this.config.tls.cert,
            key: this.config.tls.key,
            ...(this.config.tls.ca !== undefined ? { ca: this.config.tls.ca } : {}),
            requestCert: this.config.tls.requireClientCert === true,
            rejectUnauthorized: this.config.tls.requireClientCert === true,
          },
          handler,
        )
        : http.createServer(handler);

      await new Promise<void>((resolve, reject) => {
        const srv = this.server!;
        srv.once('error', reject);
        srv.listen(this.config.port, this.config.host, () => {
          srv.removeListener('error', reject);
          resolve();
        });
      });
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.server) return;

      await new Promise<void>((resolve) => {
        this.server!.close(() => { resolve(); });
      });

      this.server = null;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.server) return;

      this.server.close();
      this.server.closeAllConnections();
      this.server = null;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  /** Handle an incoming HTTP request. */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method?.toUpperCase() !== this.config.method.toUpperCase()) {
      this.writePlain(res, 405, 'Method Not Allowed');
      return;
    }

    const reqPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (reqPath !== this.config.path) {
      this.writePlain(res, 404, 'Not Found');
      return;
    }

    if (this.config.auth && !this.isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Basic' });
      res.end('Unauthorized');
      return;
    }

    if (!this.dispatcher) {
      this.writePlain(res, 500, 'No dispatcher configured');
      return;
    }

    await this.dispatchRequest(req, res, reqPath);
  }

  /** Read the body, dispatch, and respond with the appropriate status. */
  private async dispatchRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqPath: string,
  ): Promise<void> {
    let body: string;
    try {
      body = await this.readBody(req);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        this.logger.warn({ remoteAddress: req.socket.remoteAddress }, 'Rejected oversized body');
        this.writePlain(res, 413, 'Payload Too Large');
        return;
      }
      this.logger.error(errorInfo(err), 'Failed reading request body');
      this.writePlain(res, 400, 'Bad Request');
      return;
    }

    const raw = this.buildRawMessage(req, body, reqPath);
    const result = await this.dispatcher!(raw);

    if (result.ok) {
      res.writeHead(this.config.responseStatusCode, { 'Content-Type': this.config.responseContentType });
      res.end(result.value.response ?? '');
      return;
    }

    // Pipeline failed — surface an error status so the sender never believes
    // the message was accepted.
    this.logger.error(errorInfo(result.error), 'Pipeline dispatch failed');
    res.writeHead(this.config.errorStatusCode, { 'Content-Type': this.config.responseContentType });
    res.end();
  }

  /** Build the raw pipeline message from the request. */
  private buildRawMessage(req: http.IncomingMessage, body: string, reqPath: string): RawMessage {
    const urlObj = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);
    const queryString: Record<string, string> = {};
    for (const [key, value] of urlObj.searchParams.entries()) {
      queryString[key] = value;
    }
    return {
      content: body,
      sourceMap: {
        remoteAddress: req.socket.remoteAddress,
        method: req.method,
        path: reqPath,
        headers: req.headers,
        queryString,
        contentType: req.headers['content-type'],
      },
    };
  }

  /** Validate the Authorization header against the configured guard. */
  private isAuthorized(req: http.IncomingMessage): boolean {
    const auth = this.config.auth;
    if (!auth) return true;
    const header = req.headers['authorization'] ?? '';
    if (auth.type === 'TOKEN') {
      return !!auth.token && constantTimeEqual(header, `Bearer ${auth.token}`);
    }
    if (!header.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return false;
    return constantTimeEqual(decoded.slice(0, sep), auth.username ?? '')
      && constantTimeEqual(decoded.slice(sep + 1), auth.password ?? '');
  }

  private writePlain(res: http.ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(message);
  }

  /** Read the full request body as a string, enforcing the size cap. */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let rejected = false;
      req.on('data', (chunk: Buffer) => {
        if (rejected) return;
        size += chunk.length;
        if (size > this.config.maxBodyBytes) {
          rejected = true;
          // Stop reading but do NOT destroy the socket — the caller still needs
          // to flush a 413 response back to the sender.
          req.pause();
          reject(new BodyTooLargeError());
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf-8')); });
      req.on('error', reject);
    });
  }
}
