import type * as http from 'node:http';
import * as https from 'node:https';
import type * as net from 'node:net';
import { settleWithin } from '../timeout.js';

/** How long a stop waits for bodies that are still arriving. */
const STOP_ARRIVAL_MS = 5_000;

/** How long a stop waits for its last answers to be read. Longer than the linger after a refused body. */
const STOP_CLOSE_MS = 3_000;

export interface Exchange {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  /** False for a request that came after a stop had begun, on a connection that was open. */
  readonly inTime: boolean;
  /** Aborted once a stop has waited long enough for the body. */
  readonly arrivalEnded: AbortSignal;
  /** For a connection that will close before it could answer another request. */
  readonly takeNoMore: () => void;
}

/**
 * One run of the server, from listening to its last connection closed.
 *
 * `server.close` waits for every connection, turns off the timeouts that would end one, and
 * goes on taking requests from those kept open, so it alone never ends for a sender that
 * stalls or keeps sending.
 */
export class HttpListener {
  private readonly server: http.Server | https.Server;
  private readonly connections = new Set<net.Socket>();
  /** What requests come on: over TLS not the connections themselves, which must not be ended under it. */
  private readonly requestSockets: Set<net.Socket>;
  private readonly takenNoMore = new WeakSet<net.Socket>();
  private readonly lastAnswers = new WeakMap<net.Socket, http.ServerResponse>();
  private readonly inProgress = new Set<Promise<void>>();
  private readonly arrival = new AbortController();
  private stopping = false;

  /** `handle` never rejects, and settles once it has answered. */
  constructor(server: http.Server | https.Server, handle: (exchange: Exchange) => Promise<void>) {
    this.server = server;
    const overTls = server instanceof https.Server;
    this.requestSockets = overTls ? new Set() : this.connections;
    server.on('connection', (socket: net.Socket) => { keepWhileOpen(this.connections, socket); });
    if (overTls) server.on('secureConnection', (socket) => { keepWhileOpen(this.requestSockets, socket); });
    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (this.takenNoMore.has(req.socket)) return;
      this.lastAnswers.set(req.socket, res);
      const work = handle(this.exchange(req, res)).finally(() => { this.inProgress.delete(work); });
      this.inProgress.add(work);
    });
  }

  listen(port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  /** Answers the requests that came before it. A message in the pipeline is waited for however long it takes. */
  async stop(): Promise<void> {
    this.stopping = true;
    const closed = new Promise<void>((resolve) => { this.server.close(() => { resolve(); }); });
    const arrival = setTimeout(() => { this.arrival.abort(); }, STOP_ARRIVAL_MS);
    await Promise.all(this.inProgress);
    clearTimeout(arrival);

    for (const socket of this.requestSockets) this.closeOnceAnswered(socket);
    await settleWithin(closed, STOP_CLOSE_MS);
    this.destroyConnections();
    await closed;
  }

  halt(): void {
    this.server.close();
    this.destroyConnections();
  }

  private exchange(req: http.IncomingMessage, res: http.ServerResponse): Exchange {
    return {
      req,
      res,
      inTime: !this.stopping,
      arrivalEnded: this.arrival.signal,
      takeNoMore: () => { this.takenNoMore.add(req.socket); },
    };
  }

  /** Answers on one connection go out in order, so with the last of them the sender has them all. */
  private closeOnceAnswered(socket: net.Socket): void {
    const last = this.lastAnswers.get(socket);
    if (!last || last.writableFinished) socket.destroySoon();
    else last.once('finish', () => { socket.destroySoon(); });
  }

  private destroyConnections(): void {
    for (const socket of [...this.requestSockets, ...this.connections]) socket.destroy();
  }
}

function keepWhileOpen(sockets: Set<net.Socket>, socket: net.Socket): void {
  sockets.add(socket);
  socket.once('close', () => { sockets.delete(socket); });
}
