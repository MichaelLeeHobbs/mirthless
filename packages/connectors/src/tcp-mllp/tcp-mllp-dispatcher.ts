// ===========================================
// TCP/MLLP Dispatcher (Destination Connector)
// ===========================================
// Sends messages to a remote TCP/MLLP server.
// Uses a connection pool for efficiency.

import * as net from 'node:net';
import * as genericPool from 'generic-pool';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { MllpParser, wrapMllp } from '../transmission/mllp-mode.js';

// ----- Config -----

export interface TcpMllpDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  readonly responseTimeout: number;
}

// ----- Dispatcher -----

export class TcpMllpDispatcher implements DestinationConnectorRuntime {
  private readonly config: TcpMllpDispatcherConfig;
  private pool: genericPool.Pool<net.Socket> | null = null;

  constructor(config: TcpMllpDispatcherConfig) {
    this.config = config;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) {
        throw new Error('Host is required');
      }
      if (!this.config.port || this.config.port < 1 || this.config.port > 65535) {
        throw new Error(`Invalid port: ${String(this.config.port)}`);
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      const factory: genericPool.Factory<net.Socket> = {
        create: () => this.createConnection(),
        destroy: async (socket) => { socket.destroy(); },
        validate: async (socket) => !socket.destroyed && socket.writable,
      };

      this.pool = genericPool.createPool(factory, {
        min: 0,
        max: this.config.maxConnections,
        idleTimeoutMillis: 30_000,
        testOnBorrow: true,
      });
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.pool) {
        throw new Error('Dispatcher not started');
      }
      if (signal.aborted) {
        throw new Error('Send aborted');
      }

      const socket = await this.pool.acquire();
      try {
        const response = await this.sendAndReceive(socket, message.content, signal);
        await this.pool.release(socket);
        return response;
      } catch (err) {
        await this.pool.destroy(socket);
        throw err;
      }
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.pool) {
        await this.pool.drain();
        await this.pool.clear();
        this.pool = null;
      }
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.pool) {
        await this.pool.drain();
        await this.pool.clear();
        this.pool = null;
      }
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.pool = null;
    });
  }

  /** Create a new TCP connection to the destination. */
  private async createConnection(): Promise<net.Socket> {
    const connectTimeout = Math.min(this.config.responseTimeout, 5_000);
    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(
        { host: this.config.host, port: this.config.port, timeout: connectTimeout },
        () => {
          socket.removeListener('timeout', onTimeout);
          resolve(socket);
        },
      );

      const onTimeout = (): void => {
        socket.destroy();
        reject(new Error(`Connect timeout after ${String(connectTimeout)}ms`));
      };

      socket.once('timeout', onTimeout);
      socket.once('error', (err) => {
        socket.removeListener('timeout', onTimeout);
        reject(err);
      });
    });
  }

  /** Send an MLLP-framed message and wait for the response. */
  private async sendAndReceive(
    socket: net.Socket,
    content: string,
    signal: AbortSignal,
  ): Promise<ConnectorResponse> {
    return new Promise<ConnectorResponse>((resolve, reject) => {
      const parser = new MllpParser();
      const timeout = this.config.responseTimeout;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Response timeout after ${String(timeout)}ms`));
      }, timeout);

      const onAbort = (): void => {
        cleanup();
        reject(new Error('Send aborted'));
      };

      const onData = (chunk: Buffer): void => {
        const msgs = parser.parse(chunk);
        if (msgs.length > 0) {
          cleanup();
          resolve({ status: 'SENT', content: msgs[0]! });
        }
      };

      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      socket.on('data', onData);
      socket.once('error', onError);

      socket.write(wrapMllp(content));
    });
  }
}
