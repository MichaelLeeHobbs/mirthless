// ===========================================
// TCP/MLLP Receiver (Source Connector)
// ===========================================
// Listens for inbound TCP connections, parses MLLP frames,
// and dispatches messages to the engine pipeline.

import * as net from 'node:net';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { MllpParser, wrapMllp } from '../transmission/mllp-mode.js';

// ----- Config -----

export interface TcpMllpReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
}

// ----- Receiver -----

export class TcpMllpReceiver implements SourceConnectorRuntime {
  private readonly config: TcpMllpReceiverConfig;
  private server: net.Server | null = null;
  private dispatcher: MessageDispatcher | null = null;
  private readonly connections = new Set<net.Socket>();

  constructor(config: TcpMllpReceiverConfig) {
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
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.maxConnections = this.config.maxConnections;

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

      // Stop accepting new connections
      await new Promise<void>((resolve) => {
        this.server!.close(() => { resolve(); });
      });

      // Gracefully end existing connections
      for (const socket of this.connections) {
        socket.end();
      }

      // Wait for connections to close (with timeout)
      if (this.connections.size > 0) {
        await Promise.race([
          new Promise<void>((resolve) => {
            const check = (): void => {
              if (this.connections.size === 0) { resolve(); return; }
              setTimeout(check, 50);
            };
            check();
          }),
          new Promise<void>((resolve) => { setTimeout(resolve, 5_000); }),
        ]);
      }

      // Force-destroy any remaining
      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      this.server = null;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.server) return;

      this.server.close();

      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      this.server = null;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  /** Handle an incoming TCP connection. */
  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
    const parser = new MllpParser();

    socket.on('data', (chunk: Buffer) => {
      const msgs = parser.parse(chunk);
      for (const content of msgs) {
        void this.processMessage(content, socket);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', () => {
      this.connections.delete(socket);
      socket.destroy();
    });
  }

  /** Process a complete MLLP message and send response. */
  private async processMessage(content: string, socket: net.Socket): Promise<void> {
    if (!this.dispatcher) return;

    const raw: RawMessage = {
      content,
      sourceMap: {
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: this.config.port,
      },
    };

    const result = await this.dispatcher(raw);

    if (result.ok && result.value.response) {
      socket.write(wrapMllp(result.value.response));
    }
  }
}
