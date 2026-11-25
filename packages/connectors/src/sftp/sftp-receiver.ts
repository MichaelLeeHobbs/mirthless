// The quarantine ledger lives as a sidecar in the remote directory so a restart
// (new instance) does not re-dispatch an already-dispatched file.

import { normalizeEncoding, isKnownEncoding, unknownEncodingMessage } from '../encoding.js';
import { stderr, tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, SourceHealthHandler, MessageDispatcher, RawMessage } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { selectsFileName } from '../file/file-receiver.js';
import { withTimeout } from '../timeout.js';
import { connectFresh, closeQuietly } from '../client-lifecycle.js';
import {
  QUARANTINE_LEDGER_NAME,
  QUARANTINE_LEDGER_NAMES,
  QuarantineLedger,
  dispatchQuarantined,
  isQuarantineLedgerName,
  isTooNew,
  type FileVersion,
  type LedgerStorage,
} from '../quarantine-ledger.js';
import {
  createSsh2SftpClient,
  validateAuth,
  type SftpClient,
  type SftpClientFactory,
  type SftpConnectionOptions,
  type SftpFileInfo,
  type SftpPathKind,
} from './sftp-client.js';

/** A hung server must not wedge the poll loop. */
const SFTP_OP_TIMEOUT_MS = 30_000;

const SFTP_POST_ACTION = {
  DELETE: 'DELETE',
  MOVE: 'MOVE',
  NONE: 'NONE',
} as const;
type SftpPostAction = typeof SFTP_POST_ACTION[keyof typeof SFTP_POST_ACTION];

export { SFTP_POST_ACTION };
export type { SftpPostAction };

export interface SftpReceiverConfig extends SftpConnectionOptions {
  readonly remoteDirectory: string;
  readonly filePattern: string;
  readonly pollingIntervalMs: number;
  readonly afterProcessing: SftpPostAction;
  readonly moveToDirectory: string;
  readonly minFileAgeMs: number;
  /** Leave names starting with `.` alone, as a Mirth File Reader does by default. */
  readonly ignoreDot: boolean;
  /** UTF-8 when unset. */
  readonly charset?: string | undefined;
}

export function joinRemote(dir: string, name: string): string {
  const trimmed = dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${trimmed}/${name}`;
}

/** One start of the source and its connection. A cycle that outlives a halt keeps its own, not a later start's. */
interface Session {
  client: SftpClient | null;
  /** False once stop or halt is asked for, so a poll cycle in progress takes no more files. */
  live: boolean;
  /** Ends once the file in hand is deleted, moved, quarantined or left. */
  file: Promise<void>;
  /** The file in hand was read: from here on it is processed and settled, whatever stops the source. */
  taken: boolean;
}

export class SftpReceiver implements SourceConnectorRuntime {
  private readonly config: SftpReceiverConfig;
  private readonly createClient: SftpClientFactory;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private health: SourceHealthHandler = () => undefined;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private session: Session | null = null;
  /** The session of the poll cycle in flight; there is never a second cycle. */
  private polling: Session | null = null;
  /** Dispatched files whose pipeline errored or whose post-action failed, so they are not re-dispatched. */
  private readonly quarantine: QuarantineLedger;

  constructor(config: SftpReceiverConfig, createClient?: SftpClientFactory, logger?: ConnectorLogger) {
    this.config = config;
    this.createClient = createClient ?? createSsh2SftpClient;
    this.logger = logger ?? createConnectorLogger('SFTP');
    this.quarantine = new QuarantineLedger(
      this.remoteLedgerStorage(), joinRemote(config.remoteDirectory, QUARANTINE_LEDGER_NAME), this.logger,
    );
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setHealthHandler(handler: SourceHealthHandler): void {
    this.health = handler;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) throw new Error('Host is required');
      if (this.config.port < 1 || this.config.port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      if (!this.config.username) throw new Error('Username is required');
      const authError = validateAuth(this.config);
      if (authError) throw new Error(authError);
      if (!this.config.remoteDirectory) throw new Error('Remote directory is required');
      if (!this.config.filePattern) throw new Error('File pattern is required');
      if (this.config.pollingIntervalMs < 100) {
        throw new Error('Polling interval must be at least 100ms');
      }
      if (this.config.afterProcessing === SFTP_POST_ACTION.MOVE && !this.config.moveToDirectory) {
        throw new Error('Move-to directory is required when afterProcessing is MOVE');
      }
      // Reading a file in the wrong encoding corrupts every non-ASCII character,
      // so an encoding this runtime cannot decode must stop the deploy.
      if (this.config.charset !== undefined && !isKnownEncoding(this.config.charset)) {
        throw new Error(unknownEncodingMessage(this.config.charset));
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }
      const session: Session = { client: null, live: true, file: Promise.resolve(), taken: false };
      await this.connect(session);
      this.session = session;
      // Merge the current and legacy (pre-rename) ledgers, so entries
      // quarantined before the rename are still skipped.
      await this.quarantine.load(QUARANTINE_LEDGER_NAMES.map((name) => joinRemote(this.config.remoteDirectory, name)));
      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  /** Waits for a file that was read, so it is deleted, moved or quarantined before its connection goes. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const session = this.endSession();
      // Not only this session's: after a pause the session is gone, and its file may be in flight.
      if (this.polling?.taken === true) await this.polling.file;
      if (session !== null) await this.disconnect(session);
    });
  }

  /** Does not wait: a file that was read keeps the connection, and the cycle closes it. */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      const session = this.endSession();
      if (session !== null && !session.taken) await this.disconnect(session);
    });
  }

  private endSession(): Session | null {
    const { session } = this;
    this.clearPollTimer();
    if (session !== null) session.live = false;
    this.session = null;
    return session;
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  private async pollCycle(): Promise<void> {
    const { session } = this;
    if (this.polling !== null || session === null || !this.dispatcher) return;
    this.polling = session;
    try {
      await this.takeFiles(session);
    } catch (err) {
      // A dropped SFTP connection or vanished directory otherwise leaves the
      // channel STARTED yet silently idle. Surface it and drop the client so
      // the next cycle reconnects.
      if (session.live) {
        this.logger.error(
          { ...errorInfo(err), remoteDirectory: this.config.remoteDirectory },
          'SFTP poll cycle failed; will reconnect',
        );
        this.health(stderr(err));
      }
      await this.disconnect(session);
    } finally {
      this.polling = null;
      if (!session.live) await this.disconnect(session);
    }
  }

  private async takeFiles(session: Session): Promise<void> {
    const { client, entries } = await this.list(session);
    if (session.live) this.health(null);
    let failed = false;
    for (const entry of entries) {
      if (!session.live) break;
      // One file that cannot be downloaded (permissions, a file removed
      // mid-poll) must not stop the files after it, this cycle or any later one.
      session.file = this.processFile(session, client, entry).catch((err: unknown) => {
        failed = true;
        // A stop or halt closes the connection under a file that is only being read.
        if (!session.live && !session.taken) return;
        this.logger.error({ ...errorInfo(err), file: entry.name }, 'SFTP file could not be processed; continuing with the next file');
      });
      await session.file;
      session.taken = false;
    }
    // The failure may have been the connection: start the next cycle on a fresh one.
    if (failed) await this.disconnect(session);
  }

  private async connect(session: Session): Promise<SftpClient> {
    const client = this.createClient(this.config);
    session.client = await connectFresh(client, SFTP_OP_TIMEOUT_MS, 'SFTP connect', () => client.end());
    return session.client;
  }

  /** A server may close a connection that is kept from poll to poll, so one that fails is replaced at once. */
  private async list(session: Session): Promise<{ readonly client: SftpClient; readonly entries: readonly SftpFileInfo[] }> {
    const kept = session.client;
    if (kept !== null) {
      const listed = await tryCatch(() => this.listMatchingFiles(kept));
      if (listed.ok) return { client: kept, entries: listed.value };
      if (!session.live) throw listed.error;
      this.logger.warn({ ...errorInfo(listed.error), remoteDirectory: this.config.remoteDirectory }, 'SFTP listing failed on the connection kept from the last poll; trying a new one');
      await this.disconnect(session);
    }
    const client = await this.connect(session);
    return { client, entries: await this.listMatchingFiles(client) };
  }

  private async listMatchingFiles(client: SftpClient): Promise<readonly SftpFileInfo[]> {
    const entries = await withTimeout(client.list(this.config.remoteDirectory), SFTP_OP_TIMEOUT_MS, 'SFTP list');
    const results: SftpFileInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile) continue;
      if (isQuarantineLedgerName(entry.name)) continue;
      if (!selectsFileName(entry.name, this.config.filePattern, this.config.ignoreDot)) continue;
      if (isTooNew(entry, this.config.minFileAgeMs)) continue; // still being written
      results.push(entry);
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  private async processFile(session: Session, client: SftpClient, entry: SftpFileInfo): Promise<void> {
    const { dispatcher } = this;
    if (!dispatcher) return;
    const remotePath = joinRemote(this.config.remoteDirectory, entry.name);
    await dispatchQuarantined({
      ledger: this.quarantine,
      logger: this.logger,
      name: entry.name,
      listed: entry,
      file: entry.name,
      minAgeMs: this.config.minFileAgeMs,
      version: () => withTimeout(client.stat(remotePath), SFTP_OP_TIMEOUT_MS, 'SFTP stat'),
      read: async (version) => {
        const message = await this.downloadMessage(client, entry.name, version);
        session.taken = session.live;
        return message;
      },
      dispatcher,
      stopped: () => !session.taken,
      postProcess: this.config.afterProcessing === SFTP_POST_ACTION.NONE ? null : () => this.postProcess(client, entry.name),
    });
  }

  private async downloadMessage(client: SftpClient, name: string, version: FileVersion): Promise<RawMessage> {
    const remotePath = joinRemote(this.config.remoteDirectory, name);
    const buffer = await withTimeout(client.get(remotePath), SFTP_OP_TIMEOUT_MS, 'SFTP get');
    return {
      content: buffer.toString(normalizeEncoding(this.config.charset)),
      sourceMap: {
        originalFilename: name,
        remoteDirectory: this.config.remoteDirectory,
        fileSize: version.size,
        lastModified: version.modifyTime,
      },
    };
  }

  private async postProcess(client: SftpClient, name: string): Promise<void> {
    const remotePath = joinRemote(this.config.remoteDirectory, name);
    switch (this.config.afterProcessing) {
      case SFTP_POST_ACTION.DELETE:
        await withTimeout(client.delete(remotePath), SFTP_OP_TIMEOUT_MS, 'SFTP delete');
        break;
      case SFTP_POST_ACTION.MOVE:
        await this.move(client, remotePath, joinRemote(this.config.moveToDirectory, name));
        break;
      case SFTP_POST_ACTION.NONE:
        break;
    }
  }

  /** Some servers replace on a rename, so the name is checked first. */
  private async move(client: SftpClient, from: string, to: string): Promise<void> {
    await withTimeout(client.mkdir(this.config.moveToDirectory), SFTP_OP_TIMEOUT_MS, 'SFTP mkdir');
    const kind = await withTimeout(client.pathKind(to), SFTP_OP_TIMEOUT_MS, 'SFTP pathKind');
    if (kind !== 'missing') throw new Error(`"${to}" already exists, so "${from}" was not moved there`);
    await withTimeout(client.rename(from, to), SFTP_OP_TIMEOUT_MS, 'SFTP rename');
  }

  private remoteLedgerStorage(): LedgerStorage {
    return {
      read: async (ledgerPath: string): Promise<string | null> => {
        const client = this.session?.client;
        if (!client) return null;
        let kind: SftpPathKind;
        try {
          kind = await withTimeout(client.pathKind(ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP pathKind');
        } catch {
          return null;
        }
        if (kind === 'missing') return null;
        const buf = await withTimeout(client.get(ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP get ledger');
        return buf.toString('utf8');
      },
      write: async (ledgerPath: string, text: string): Promise<void> => {
        // Only a cycle writes it, on its own session: a later start's may not be connected yet.
        const client = this.polling?.client;
        if (!client) throw new Error('not connected');
        await withTimeout(client.put(Buffer.from(text, 'utf8'), ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP put ledger');
      },
    };
  }

  private async disconnect(session: Session): Promise<void> {
    const { client } = session;
    if (!client) return;
    session.client = null;
    await closeQuietly({
      close: () => client.end(),
      timeoutMs: SFTP_OP_TIMEOUT_MS,
      label: 'SFTP end',
      logger: this.logger,
      message: 'Error disconnecting SFTP client',
    });
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
