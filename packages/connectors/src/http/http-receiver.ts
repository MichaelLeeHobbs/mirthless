// ===========================================
// HTTP Receiver (Source Connector)
// ===========================================
// Listens for inbound HTTP requests and dispatches
// messages to the engine pipeline.

import * as http from 'node:http';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';

// ----- Config -----

export interface HttpReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly method: string;
  readonly responseContentType: string;
  readonly responseStatusCode: number;
}

// ----- Receiver -----

export class HttpReceiver implements SourceConnectorRuntime {
  private readonly config: HttpReceiverConfig;
  private server: http.Server | null = null;
  private dispatcher: MessageDispatcher | null = null;

  constructor(config: HttpReceiverConfig) {
    this.config = config;
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
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

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
    // Check method matches
    if (req.method?.toUpperCase() !== this.config.method.toUpperCase()) {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // Check path matches
    const reqPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (reqPath !== this.config.path) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (!this.dispatcher) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('No dispatcher configured');
      return;
    }

    // Read request body
    const body = await this.readBody(req);

    // Parse query string
    const urlObj = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);
    const queryString: Record<string, string> = {};
    for (const [key, value] of urlObj.searchParams.entries()) {
      queryString[key] = value;
    }

    // Build raw message
    const raw: RawMessage = {
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

    const result = await this.dispatcher(raw);

    if (result.ok && result.value.response) {
      res.writeHead(this.config.responseStatusCode, {
        'Content-Type': this.config.responseContentType,
      });
      res.end(result.value.response);
    } else {
      res.writeHead(this.config.responseStatusCode, {
        'Content-Type': this.config.responseContentType,
      });
      res.end();
    }
  }

  /** Read the full request body as a string. */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf-8')); });
      req.on('error', reject);
    });
  }
}
