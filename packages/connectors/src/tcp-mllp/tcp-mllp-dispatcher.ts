import * as net from 'node:net';
import * as tls from 'node:tls';
import * as genericPool from 'generic-pool';
import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { MllpParser, wrapMllp, type Framing } from '../transmission/mllp-mode.js';
import type { TlsClientOptions } from '../tls.js';
import { classifyAckResponse, controlIdOf, type SentControlId } from './ack-builder.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

export interface TcpMllpDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  readonly responseTimeout: number;
  readonly acquireTimeoutMs: number;
  readonly charset: BufferEncoding;
  readonly tls?: TlsClientOptions | undefined;
  /** MLLP when unset. */
  readonly framing?: Framing | undefined;
}

export class TcpMllpDispatcher implements DestinationConnectorRuntime {
  private readonly config: TcpMllpDispatcherConfig;
  private readonly logger: ConnectorLogger;
  private pool: genericPool.Pool<net.Socket> | null = null;

  constructor(config: TcpMllpDispatcherConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('TCP_MLLP');
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
        acquireTimeoutMillis: this.config.acquireTimeoutMs,
        testOnBorrow: true,
      });
      // The pool surfaces background factory-create failures via this event;
      // without a listener generic-pool logs to stderr and can reject noisily.
      this.pool.on('factoryCreateError', (err) => {
        this.logger.error(errorInfo(err), 'MLLP connection factory create error');
      });
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.pool) {
        throw new Error('Dispatcher not started');
      }

      const socket = await this.acquireSocket(signal);
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

  private async acquireSocket(signal: AbortSignal): Promise<net.Socket> {
    if (signal.aborted) throw new Error('Send aborted');
    const pool = this.pool!;
    const acquirePromise = pool.acquire();

    return new Promise<net.Socket>((resolve, reject) => {
      const onAbort = (): void => { reject(new Error('Send aborted')); };
      signal.addEventListener('abort', onAbort, { once: true });

      acquirePromise.then(
        (socket) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            void pool.release(socket);
            reject(new Error('Send aborted'));
            return;
          }
          resolve(socket);
        },
        (err: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
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

  private async createConnection(): Promise<net.Socket> {
    const connectTimeout = Math.min(this.config.responseTimeout, 5_000);
    return new Promise<net.Socket>((resolve, reject) => {
      const socket = this.openSocket(connectTimeout, () => {
        socket.removeListener('timeout', onTimeout);
        this.attachIdleHandlers(socket);
        resolve(socket);
      });

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

  private openSocket(timeout: number, onConnect: () => void): net.Socket {
    if (this.config.tls) {
      const t = this.config.tls;
      return tls.connect({
        host: this.config.host,
        port: this.config.port,
        timeout,
        rejectUnauthorized: t.rejectUnauthorized !== false,
        ...(t.ca !== undefined ? { ca: t.ca } : {}),
        ...(t.cert !== undefined ? { cert: t.cert } : {}),
        ...(t.key !== undefined ? { key: t.key } : {}),
      }, onConnect);
    }
    return net.createConnection(
      { host: this.config.host, port: this.config.port, timeout },
      onConnect,
    );
  }

  /** Without these, an error on an idle socket becomes an uncaughtException that takes down the engine. */
  private attachIdleHandlers(socket: net.Socket): void {
    socket.on('error', (err) => {
      this.logger.error(errorInfo(err), 'Idle pooled MLLP socket error; evicting');
      socket.destroy();
    });
    socket.on('close', () => { socket.destroy(); });
  }

  private async sendAndReceive(
    socket: net.Socket,
    content: string,
    signal: AbortSignal,
  ): Promise<ConnectorResponse> {
    return new Promise<ConnectorResponse>((resolve, reject) => {
      const parser = new MllpParser({ charset: this.config.charset, ...(this.config.framing ? { framing: this.config.framing } : {}) });
      const timeout = this.config.responseTimeout;
      const sentControlId = controlIdOf(content);

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Response timeout after ${String(timeout)}ms`));
      }, timeout);

      const onAbort = (): void => {
        cleanup();
        reject(new Error('Send aborted'));
      };

      const onData = (chunk: Buffer): void => {
        let msgs: readonly string[];
        try {
          msgs = parser.parse(chunk);
        } catch (err) {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        if (msgs.length > 0) {
          cleanup();
          resolve(toResponse(msgs[0]!, sentControlId));
        }
      };

      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      // A clean remote FIN before an ACK arrives should fail fast, not wait out the
      // full responseTimeout.
      const onClose = (): void => {
        cleanup();
        reject(new Error('MLLP connection closed before an acknowledgement was received'));
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);

      socket.write(wrapMllp(content, this.config.charset, this.config.framing));
    });
  }
}

function toResponse(ack: string, sentControlId: SentControlId | undefined): ConnectorResponse {
  const classification = classifyAckResponse(ack, sentControlId);
  if (classification.accepted) {
    return { status: 'SENT', content: ack };
  }
  return {
    status: 'ERROR',
    content: ack,
    errorMessage: classification.errorMessage ?? 'Negative acknowledgement',
  };
}
