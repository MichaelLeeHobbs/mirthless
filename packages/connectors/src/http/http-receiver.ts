import * as http from 'node:http';
import * as https from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { tryCatch, type Result } from '@galvanigraph/core-util';
import { DEFAULT_MAX_BODY_BYTES, type QueueCharset } from '@galvanigraph/core-models';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import type { TlsServerOptions } from '../tls.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { assertCharsetAvailable } from '../encoding.js';
import { Decompressor } from './decompression.js';
import { RefusedBodyError } from './refused-body.js';
import { readRequestBody, type RequestBody } from './request-body.js';

/** Hashing first keeps the length from leaking and meets timingSafeEqual's equal-length rule. */
function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

export interface HttpAuthConfig {
  readonly type: 'BASIC' | 'TOKEN';
  readonly username?: string | undefined;
  readonly password?: string | undefined;
  readonly token?: string | undefined;
}

export { DEFAULT_MAX_BODY_BYTES };

/** A guard missing a credential would compare against an empty one and let the request in (#207). */
function missingCredential(auth: HttpAuthConfig | undefined): string | undefined {
  if (!auth) return undefined;
  if (auth.type === 'TOKEN') return auth.token ? undefined : 'auth type TOKEN needs a token';
  return auth.username && auth.password ? undefined : 'auth type BASIC needs a username and a password';
}

export interface HttpReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  /**
   * Any path under `path` too, as Mirth's HTTP Listener takes its context path. The
   * source map carries the request path as `path` and, under Mirth's name, `contextPath`.
   */
  readonly matchSubpaths?: boolean | undefined;
  readonly method: string;
  readonly responseContentType: string;
  readonly responseStatusCode: number;
  /** For a failed pipeline dispatch, or an error in handling the request. */
  readonly errorStatusCode: number;
  readonly maxBodyBytes: number;
  /** For a body whose Content-Type declares no charset, except `base64`, which keeps the bytes of every body. */
  readonly bodyCharset: QueueCharset;
  readonly auth?: HttpAuthConfig | undefined;
  readonly tls?: TlsServerOptions | undefined;
}

const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key']);

/**
 * The source map is stored with the message and shown in the message browser. The
 * header name is kept so a script can still tell that a credential was sent.
 */
function withoutCredentials(headers: http.IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const safe: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    safe[name] = CREDENTIAL_HEADERS.has(name) ? '[redacted]' : value;
  }
  return safe;
}

export class HttpReceiver implements SourceConnectorRuntime {
  private readonly config: HttpReceiverConfig;
  private readonly logger: ConnectorLogger;
  private readonly decompressor: Decompressor;
  private server: http.Server | null = null;
  private dispatcher: MessageDispatcher | null = null;

  constructor(config: HttpReceiverConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('HTTP');
    this.decompressor = new Decompressor(config.maxBodyBytes);
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
      const authError = missingCredential(this.config.auth);
      if (authError) throw new Error(authError);
      assertCharsetAvailable(this.config.bodyCharset);
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
        this.handleRequest(req, res).catch((err: unknown) => { this.answerFailure(req, res, err); });
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

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method?.toUpperCase() !== this.config.method.toUpperCase()) {
      this.writePlain(res, 405, 'Method Not Allowed');
      return;
    }

    const reqPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (!this.acceptsPath(reqPath)) {
      this.writePlain(res, 404, 'Not Found');
      return;
    }

    if (this.config.auth && !this.isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Basic' });
      res.end('Unauthorized');
      return;
    }

    await this.dispatchRequest(req, res, reqPath);
  }

  /** A request left unanswered would hold its sender until a timeout, without saying whether to send again. */
  private answerFailure(req: http.IncomingMessage, res: http.ServerResponse, err: unknown): void {
    this.logger.error({ ...errorInfo(err), remoteAddress: req.socket.remoteAddress }, 'Request handling failed');
    if (res.headersSent) {
      req.socket.destroy();
      return;
    }
    res.writeHead(this.config.errorStatusCode);
    res.end();
  }

  private acceptsPath(reqPath: string): boolean {
    const base = this.config.path;
    if (reqPath === base) return true;
    if (!this.config.matchSubpaths) return false;
    return reqPath.startsWith(base.endsWith('/') ? base : `${base}/`);
  }

  private async dispatchRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqPath: string,
  ): Promise<void> {
    // Undefined once the connection has closed.
    const { remoteAddress } = req.socket;
    let body: RequestBody;
    try {
      body = await readRequestBody(req, this.config, this.decompressor);
    } catch (err) {
      this.refuseBody(req, res, err);
      return;
    }

    try {
      // A halt destroys every connection, so this covers one too. The sender got no answer and
      // sends again: dispatching now would take the message twice.
      if (req.socket.destroyed) {
        this.logger.warn({ remoteAddress }, 'Request not dispatched: its connection closed while the body was being read');
        return;
      }
      await this.dispatchAndAnswer(res, this.buildRawMessage(req, body.text, reqPath));
    } finally {
      body.release();
    }
  }

  private async dispatchAndAnswer(res: http.ServerResponse, raw: RawMessage): Promise<void> {
    const { dispatcher } = this;
    if (!dispatcher) {
      this.writePlain(res, 503, 'Service Unavailable');
      return;
    }

    const result = await dispatcher(raw);

    const failure = dispatchFailure(result);
    if (result.ok && failure === null) {
      res.writeHead(this.config.responseStatusCode, { 'Content-Type': this.config.responseContentType });
      res.end(result.value.response ?? '');
      return;
    }

    // The pipeline failed, or took the message and recorded an error. Either
    // way surface an error status so the sender never believes it succeeded.
    this.logger.error(errorInfo(failure), 'Pipeline dispatch failed');
    res.writeHead(this.config.errorStatusCode, { 'Content-Type': this.config.responseContentType });
    res.end();
  }

  private refuseBody(req: http.IncomingMessage, res: http.ServerResponse, err: unknown): void {
    if (!(err instanceof RefusedBodyError)) {
      this.logger.error(errorInfo(err), 'Failed reading request body');
      this.writePlain(res, 400, 'Bad Request');
      return;
    }
    const context = { remoteAddress: req.socket.remoteAddress, contentType: req.headers['content-type'], status: err.status };
    this.logger.warn(context, `Refused a request body: ${err.message}`);
    res.writeHead(err.status, { 'Content-Type': 'text/plain', ...err.headers });
    res.end(err.message);
  }

  private buildRawMessage(req: http.IncomingMessage, body: string, reqPath: string): RawMessage {
    // Not through URL, which throws on a malformed Host header or a target such as //.
    const query = new URLSearchParams((req.url ?? '/').slice(reqPath.length));
    // Assigned key by key, a parameter named __proto__ would be dropped.
    const queryString: Readonly<Record<string, string>> = Object.fromEntries(query);
    return {
      content: body,
      sourceMap: {
        remoteAddress: req.socket.remoteAddress,
        method: req.method,
        path: reqPath,
        contextPath: reqPath,
        headers: withoutCredentials(req.headers),
        queryString,
        contentType: req.headers['content-type'],
      },
    };
  }

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
}
