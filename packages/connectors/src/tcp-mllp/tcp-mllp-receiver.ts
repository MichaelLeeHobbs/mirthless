import * as net from 'node:net';
import * as tls from 'node:tls';
import { settleWithin, tryCatch, type Result } from '@galvanigraph/core-util';
import type {
  SourceConnectorRuntime,
  MessageDispatcher,
  RawMessage,
  DispatchResult,
} from '../base.js';
import { DISPATCH_STATUS, dispatchFailure } from '../base.js';
import { MllpParser, frameBytes, wrapMllp, type Framing } from '../transmission/mllp-mode.js';
import type { TlsServerOptions } from '../tls.js';
import { buildAck, type AckCode } from './ack-builder.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

const IDLE_SOCKET_TIMEOUT_MS = 300_000;

/** How long a stop waits for an answer to be sent, which takes a sender that reads once its buffers are full. */
const STOP_SEND_MS = 15_000;

/** How long a sender that was answered then has to read the answer and close. */
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

interface Connection {
  readonly socket: net.Socket;
  /** Ends once the messages that came on it are answered, or left. */
  answered: Promise<void>;
  /** Messages that came on it and wait for their turn. */
  waiting: number;
  /** A message that came on it is being processed. */
  inHand: boolean;
  /** It was answered, perhaps just now: its sender may not have read that yet. */
  hasAnswered: boolean;
}

/** One start of the source. A message that outlives a halt belongs to its own, not to a later start's. */
interface Run {
  readonly server: net.Server;
  /** Over TLS the sockets below the connections, so one that stalls in its handshake is in here too. */
  readonly sockets: Set<net.Socket>;
  readonly connections: Set<Connection>;
  readonly inProgress: Set<Promise<void>>;
  /** False once stop or halt is asked for. */
  live: boolean;
  readonly halt: () => void;
  readonly halted: Promise<void>;
  stopped: Promise<void> | null;
}

function newRun(server: net.Server): Run {
  let halt = (): void => undefined;
  const halted = new Promise<void>((resolve) => { halt = resolve; });
  const sockets = new Set<net.Socket>();
  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket);
    socket.once('close', () => { sockets.delete(socket); });
  });
  return { server, sockets, connections: new Set(), inProgress: new Set(), live: true, halt, halted, stopped: null };
}

export class TcpMllpReceiver implements SourceConnectorRuntime {
  private readonly config: TcpMllpReceiverConfig;
  private readonly logger: ConnectorLogger;
  private run: Run | null = null;
  private dispatcher: MessageDispatcher | null = null;

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

      const { server, acceptEvent } = this.createServer();
      server.maxConnections = this.config.maxConnections;
      const run = newRun(server);
      server.on(acceptEvent, (socket: net.Socket) => { this.handleConnection(run, socket); });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.config.port, this.config.host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      this.run = run;
    });
  }

  private createServer(): { readonly server: net.Server; readonly acceptEvent: 'connection' | 'secureConnection' } {
    const t = this.config.tls;
    if (!t) return { server: net.createServer(), acceptEvent: 'connection' };
    const server = tls.createServer({
      cert: t.cert,
      key: t.key,
      ...(t.ca !== undefined ? { ca: t.ca } : {}),
      requestCert: t.requireClientCert === true,
      rejectUnauthorized: t.requireClientCert === true,
    });
    return { server, acceptEvent: 'secureConnection' };
  }

  /**
   * Answers the messages in hand, however long they take, until a halt. Those that came after
   * them, or wait behind them on their connection, are not acknowledged, so their sender keeps them.
   */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const { run } = this;
      if (!run) return;
      run.stopped ??= this.stopRun(run);
      await run.stopped;
      if (this.run === run) this.run = null;
    });
  }

  private async stopRun(run: Run): Promise<void> {
    run.live = false;
    // HL7 senders hold their connection open, and `close` completes only once every one is gone.
    const listenerClosed = new Promise<void>((resolve) => { run.server.close(() => { resolve(); }); });
    const closing = [...run.connections].map((connection) => this.closeOnceAnswered(connection));
    // Not only the connections': a message whose sender has gone is in hand too.
    await Promise.race([Promise.all([...closing, ...run.inProgress]), run.halted]);
    for (const socket of run.sockets) socket.destroy();
    await listenerClosed;
  }

  private async closeOnceAnswered(connection: Connection): Promise<void> {
    const { socket } = connection;
    await connection.answered;
    if (socket.destroyed) return;
    const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve(); }); });
    const sent = new Promise<void>((resolve) => { socket.end(() => { resolve(); }); });
    // Destroyed while its sender still sends, the connection would be reset and the answer lost.
    if (await settleWithin(sent, STOP_SEND_MS) && connection.hasAnswered) await settleWithin(closed, STOP_CLOSE_MS);
    socket.destroy();
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      const { run } = this;
      if (!run) return;
      this.run = null;
      run.live = false;
      run.server.close();
      run.halt();
      for (const connection of run.connections) connection.socket.destroy();
      for (const socket of run.sockets) socket.destroy();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  private handleConnection(run: Run, socket: net.Socket): void {
    // Over TLS a handshake can end after the stop began.
    if (!run.live) {
      socket.destroy();
      return;
    }
    const connection: Connection = { socket, answered: Promise.resolve(), waiting: 0, inHand: false, hasAnswered: false };
    run.connections.add(connection);

    // Close idle connections so dead/half-open sockets don't accumulate and fill
    // maxConnections, after which new senders would be silently refused.
    socket.setTimeout(IDLE_SOCKET_TIMEOUT_MS);
    socket.on('timeout', () => {
      if (connection.inHand) {
        // Only traffic re-arms it, and a message may end without an answer.
        socket.setTimeout(IDLE_SOCKET_TIMEOUT_MS);
        return;
      }
      this.logger.warn({ remoteAddress: socket.remoteAddress }, 'MLLP connection idle timeout; closing');
      socket.destroy();
    });

    const parser = new MllpParser({
      maxFrameBytes: this.config.maxFrameBytes,
      charset: this.config.charset,
      ...(this.config.framing ? { framing: this.config.framing } : {}),
    });
    socket.on('data', (chunk: Buffer) => { this.receive(run, connection, parser, chunk); });
    socket.on('close', () => { run.connections.delete(connection); });
    socket.on('error', (err) => {
      this.logger.error(errorInfo(err), 'MLLP connection error');
      socket.destroy();
    });
  }

  private receive(run: Run, connection: Connection, parser: MllpParser, chunk: Buffer): void {
    // Read and dropped: unread, it would reset the connection, and the answer to the message in hand be lost.
    if (!run.live) return;
    let msgs: readonly string[];
    try {
      msgs = parser.parse(chunk);
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), remoteAddress: connection.socket.remoteAddress },
        'MLLP frame rejected; destroying connection',
      );
      connection.socket.destroy();
      return;
    }
    for (const content of msgs) this.enqueue(run, connection, content);
  }

  /** One after the other: HL7 senders assume strict request and response, so answers must not interleave. */
  private enqueue(run: Run, connection: Connection, content: string): void {
    connection.waiting += 1;
    const work = connection.answered
      .then(() => this.takeMessage(run, connection, content))
      .catch((err: unknown) => {
        this.logger.error(errorInfo(err), 'Unexpected error processing MLLP message');
      })
      .finally(() => { run.inProgress.delete(work); });
    run.inProgress.add(work);
    connection.answered = work;
  }

  private async takeMessage(run: Run, connection: Connection, content: string): Promise<void> {
    if (!run.live) {
      if (connection.waiting === 0) return;
      this.logger.warn(
        { remoteAddress: connection.socket.remoteAddress, messages: connection.waiting },
        'MLLP messages not taken: the source was stopped before their turn came. They are not acknowledged, so their sender keeps them',
      );
      connection.waiting = 0;
      return;
    }
    connection.waiting -= 1;
    connection.inHand = true;
    try {
      await this.processMessage(content, connection);
    } finally {
      connection.inHand = false;
    }
  }

  private async processMessage(content: string, connection: Connection): Promise<void> {
    if (!this.dispatcher) return;
    const { socket } = connection;

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
    if (!socket.writable) return;
    socket.write(answer);
    connection.hasAnswered = true;
  }

  /** Never fails, whatever the charset makes of the delimiters and ids it repeats: the message was handled. */
  private ackFrame(content: string, result: Result<DispatchResult>): Buffer {
    return frameBytes(Buffer.from(buildAck(content, ackCodeFor(result)), this.config.charset), this.config.framing);
  }

  /**
   * Null when there is no response to pass through, so the sender gets an ACK or NAK: it is never left without an answer.
   * A message recorded with an ERROR status gets the NAK, because the response may be the AA of a destination that worked.
   */
  private passthroughFrame(result: Result<DispatchResult>): Buffer | null {
    if (this.config.responseMode !== MLLP_RESPONSE_MODE.PASSTHROUGH) return null;
    if (!result.ok || dispatchFailure(result) !== null || result.value.response === undefined) return null;
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
