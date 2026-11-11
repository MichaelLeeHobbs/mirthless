// ===========================================
// TCP/MLLP Receiver (Source Connector)
// ===========================================
// Listens for inbound TCP (optionally TLS) connections, parses MLLP frames,
// and dispatches messages to the engine pipeline. Responds with a real HL7
// ACK/NAK by default — never raw destination content.

import * as net from 'node:net';
import * as tls from 'node:tls';
import { tryCatch, type Result } from '@galvaniflow/core-util';
import type {
  SourceConnectorRuntime,
  MessageDispatcher,
  RawMessage,
  DispatchResult,
} from '../base.js';
import { DISPATCH_STATUS } from '../base.js';
import { MllpParser, wrapMllp } from '../transmission/mllp-mode.js';
import type { TlsServerOptions } from '../tls.js';
import { buildAck, type AckCode } from './ack-builder.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

/** Close an inbound MLLP connection after this long with no traffic. */
const IDLE_SOCKET_TIMEOUT_MS = 300_000;

/** On stop, how long messages already being processed get to finish and be acknowledged. */
const STOP_DRAIN_MS = 5_000;

/** On stop, how long to wait for sockets to close once they have been told to. */
const STOP_CLOSE_MS = 2_000;

/** Resolve when `work` settles or after `ms`, whichever is first. */
async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  await Promise.race([work.then(() => undefined, () => undefined), timeout]);
  clearTimeout(timer);
}

// ----- Config -----

/**
 * How the receiver acknowledges an inbound message.
 * - AUTO_ACK: generate a real HL7 ACK/NAK from the inbound MSH (default).
 * - PASSTHROUGH: return the pipeline/destination response verbatim (legacy).
 */
export const MLLP_RESPONSE_MODE = {
  AUTO_ACK: 'AUTO_ACK',
  PASSTHROUGH: 'PASSTHROUGH',
} as const;
export type MllpResponseMode = typeof MLLP_RESPONSE_MODE[keyof typeof MLLP_RESPONSE_MODE];

export interface TcpMllpReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  /** Acknowledgement strategy. Defaults to AUTO_ACK. */
  readonly responseMode: MllpResponseMode;
  /** Payload charset for framing/parsing. Defaults to utf-8. */
  readonly charset: BufferEncoding;
  /** Max buffered bytes per connection before rejecting (DoS guard). */
  readonly maxFrameBytes: number;
  /** Optional TLS termination. When present the server speaks TLS. */
  readonly tls?: TlsServerOptions | undefined;
}

// ----- Receiver -----

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

  /** Create a plain-TCP or TLS server depending on config. */
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
   * Stop gracefully. HL7 senders hold their connection open, and `server.close`
   * only completes once every connection is gone, so the order matters:
   *   1. stop accepting connections and stop reading new messages,
   *   2. let messages already being processed finish and send their ACK,
   *   3. close the connections, then wait for the listener to close.
   * A message that arrives after step 1 is neither processed nor acknowledged,
   * so the sender still holds it and resends it elsewhere or later.
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

  /** Handle an incoming TCP connection. */
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

  /** Process a complete MLLP message and send an acknowledgement. */
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
    const response = this.buildResponse(content, result);
    if (response !== null && socket.writable) {
      socket.write(wrapMllp(response, this.config.charset));
    }
  }

  /** Determine the wire response for a dispatched message. */
  private buildResponse(content: string, result: Result<DispatchResult>): string | null {
    if (this.config.responseMode === MLLP_RESPONSE_MODE.PASSTHROUGH) {
      if (result.ok && result.value.response !== undefined) return result.value.response;
      // No passthrough content available — fall back to an ACK/NAK so the
      // sender is never left without a response.
      return buildAck(content, ackCodeFor(result));
    }
    return buildAck(content, ackCodeFor(result));
  }
}

/** Map a dispatch result to an HL7 acknowledgement code: AE for an error, AA otherwise (filtered included). */
function ackCodeFor(result: Result<DispatchResult>): AckCode {
  if (!result.ok) return 'AE';
  const status = result.value.status;
  if (status === DISPATCH_STATUS.ERROR) return 'AE';
  // A filtered message was received and deliberately not routed. That is an
  // accept: AR tells many sending systems to stop the interface or resend
  // forever, and the HTTP listener answers 200 for the same case.
  return 'AA';
}
