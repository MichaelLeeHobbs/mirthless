import * as net from 'node:net';
import * as tls from 'node:tls';
import { settleWithin, tryCatch, type Result } from '@galvanigraph/core-util';
import type {
  SourceConnectorRuntime,
  MessageDispatcher,
  RawMessage,
  DispatchResult,
} from '../base.js';
import { DISPATCH_STATUS } from '../base.js';
import { MllpParser, frameBytes, wrapMllp, type Framing } from '../transmission/mllp-mode.js';
import type { TlsServerOptions } from '../tls.js';
import { buildAck, type AckCode } from './ack-builder.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

const IDLE_SOCKET_TIMEOUT_MS = 300_000;

const STOP_DRAIN_MS = 5_000;

const STOP_CLOSE_MS = 2_000;

/** PASSTHROUGH returns the pipeline response verbatim; AUTO_ACK builds an HL7 ACK/NAK from the inbound MSH. */
export const MLLP_RESPONSE_MODE = {
  AUTO_ACK: 'AUTO_ACK',
  PASSTHROUGH: 'PASSTHROUGH',
} as const;
export type MllpResponseMode = typeof MLLP_RESPONSE_MODE[keyof typeof MLLP_RESPONSE_MODE];

export interface TcpMllpReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  readonly responseMode: MllpResponseMode;
  readonly charset: BufferEncoding;
  /** Per-connection buffer cap, a DoS guard. */
  readonly maxFrameBytes: number;
  readonly tls?: TlsServerOptions | undefined;
  /** MLLP when unset. */
  readonly framing?: Framing | undefined;
}

export class TcpMllpReceiver implements SourceConnectorRuntime {
  private readonly config: TcpMllpReceiverConfig;
  private readonly logger: ConnectorLogger;
  private server: net.Server | null = null;
  private dispatcher: MessageDispatcher | null = null;
  private readonly connections = new Set<net.Socket>();
  /** Per-connection processing chain, so stop can wait for work in flight. */
  private readonly chains = new Map<net.Socket, Promise<void>>();
  private stopping = false;

  constructor(config: TcpMllpReceiverConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('TCP_MLLP');
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.port || this.config.port < 1 || this.config.port > 65535) {
        throw new Error(`Invalid port: ${String(this.config.port)}`);
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

      this.stopping = false;
      this.server = this.createServer();
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

  private createServer(): net.Server {
    const onConnection = (socket: net.Socket): void => { this.handleConnection(socket); };
    if (this.config.tls) {
      const t = this.config.tls;
      return tls.createServer(
        {
          cert: t.cert,
          key: t.key,
          ...(t.ca !== undefined ? { ca: t.ca } : {}),
          requestCert: t.requireClientCert === true,
          rejectUnauthorized: t.requireClientCert === true,
        },
        onConnection,
      );
    }
    return net.createServer(onConnection);
  }

  /**
   * HL7 senders hold their connection open and `server.close` completes only
   * once every connection is gone, so the order matters: stop reading, let
   * in-flight messages finish and ACK, then close the connections. A message
   * arriving after reading stops is not acknowledged, so the sender keeps it.
   */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const server = this.server;
      if (!server) return;

      this.stopping = true;
      const listenerClosed = new Promise<void>((resolve) => { server.close(() => { resolve(); }); });

      await settleWithin(Promise.all([...this.chains.values()]), STOP_DRAIN_MS);

      // destroySoon flushes a pending ACK before closing the socket.
      for (const socket of this.connections) {
        socket.destroySoon();
      }
      await settleWithin(listenerClosed, STOP_CLOSE_MS);

      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      this.chains.clear();
      await listenerClosed;
      this.server = null;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.server) return;

      this.stopping = true;
      this.server.close();

      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      this.chains.clear();
      this.server = null;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);

    // Close idle connections so dead/half-open sockets don't accumulate and fill
    // maxConnections, after which new senders would be silently refused.
    socket.setTimeout(IDLE_SOCKET_TIMEOUT_MS);
    socket.on('timeout', () => {
      this.logger.warn({ remoteAddress: socket.remoteAddress }, 'MLLP connection idle timeout; closing');
      socket.destroy();
    });

    const parser = new MllpParser({
      maxFrameBytes: this.config.maxFrameBytes,
      charset: this.config.charset,
      ...(this.config.framing ? { framing: this.config.framing } : {}),
    });
    // Serialize processing per connection: HL7 senders assume strict
    // sequential request/response, so ACKs must not interleave.
    let chain: Promise<void> = Promise.resolve();

    socket.on('data', (chunk: Buffer) => {
      // Stopping: take no new work. Unacknowledged, the message stays with the sender.
      if (this.stopping) {
        socket.destroy();
        return;
      }
      let msgs: readonly string[];
      try {
        msgs = parser.parse(chunk);
      } catch (err) {
        this.logger.error(
          { ...errorInfo(err), remoteAddress: socket.remoteAddress },
          'MLLP frame rejected; destroying connection',
        );
        socket.destroy();
        return;
      }
      for (const content of msgs) {
        chain = chain
          .then(() => this.processMessage(content, socket))
          .catch((err: unknown) => {
            this.logger.error(errorInfo(err), 'Unexpected error processing MLLP message');
          });
      }
      this.chains.set(socket, chain);
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      this.chains.delete(socket);
    });

    socket.on('error', (err) => {
      this.logger.error(errorInfo(err), 'MLLP connection error');
      this.connections.delete(socket);
      socket.destroy();
    });
  }

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
    const answer = this.passthroughFrame(result) ?? this.ackFrame(content, result);
    if (socket.writable) socket.write(answer);
  }

  /** Never fails, whatever the charset makes of the delimiters and ids it repeats: the message was handled. */
  private ackFrame(content: string, result: Result<DispatchResult>): Buffer {
    return frameBytes(Buffer.from(buildAck(content, ackCodeFor(result)), this.config.charset), this.config.framing);
  }

  /** Null when there is no response to pass through, so the sender gets an ACK or NAK: it is never left without an answer. */
  private passthroughFrame(result: Result<DispatchResult>): Buffer | null {
    if (this.config.responseMode !== MLLP_RESPONSE_MODE.PASSTHROUGH) return null;
    if (!result.ok || result.value.response === undefined) return null;
    try {
      return wrapMllp(result.value.response, this.config.charset, this.config.framing);
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), messageId: result.value.messageId },
        'The response cannot be written in the charset of the source; sending an ACK or NAK instead',
      );
      return null;
    }
  }
}

function ackCodeFor(result: Result<DispatchResult>): AckCode {
  if (!result.ok) return 'AE';
  const status = result.value.status;
  if (status === DISPATCH_STATUS.ERROR) return 'AE';
  // A filtered message was received and deliberately not routed. That is an
  // accept: AR tells many sending systems to stop the interface or resend
  // forever, and the HTTP listener answers 200 for the same case.
  return 'AA';
}
