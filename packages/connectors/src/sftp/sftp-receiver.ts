// ===========================================
// SFTP Receiver (Source Connector)
// ===========================================
// Polls a remote SFTP directory for files matching a glob pattern, downloads
// each, dispatches its content as a message, then applies post-processing
// (delete, move, or leave). Mirrors the File connector: reentrancy guard,
// file-age skip, durable quarantine, and loud poll-cycle logging. The
// quarantine ledger lives as a sidecar in the remote directory so a restart
// (new instance) does not re-dispatch an already-dispatched file.

import { normalizeEncoding, isKnownEncoding, unknownEncodingMessage } from '../encoding.js';
import { tryCatch, type Result } from '@galvaniflow/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { matchGlob } from '../file/file-receiver.js';
import { withTimeout } from '../timeout.js';
import { QuarantineLedger, type LedgerStorage } from '../quarantine-ledger.js';
import {
  createSsh2SftpClient,
  validateAuth,
  type SftpClient,
  type SftpClientFactory,
  type SftpConnectionOptions,
  type SftpFileInfo,
} from './sftp-client.js';

/** Bound each SFTP operation — a hung server must not wedge the poll loop. */
const SFTP_OP_TIMEOUT_MS = 30_000;

/**
 * Sidecar ledger file (in the remote directory) that persists the quarantine
 * set across restarts. Excluded from polling so it is never dispatched.
 */
const QUARANTINE_LEDGER = '.galvaniflow-quarantine.json';
/**
 * Ledger name used before the GalvaniFlow rename. Still read (merged into the
 * set) and never dispatched, but never written: the next persist carries its
 * entries into {@link QUARANTINE_LEDGER}.
 */
const LEGACY_QUARANTINE_LEDGER = '.mirthless-quarantine.json';

// ----- Constants -----

const SFTP_POST_ACTION = {
  DELETE: 'DELETE',
  MOVE: 'MOVE',
  NONE: 'NONE',
} as const;
type SftpPostAction = typeof SFTP_POST_ACTION[keyof typeof SFTP_POST_ACTION];

export { SFTP_POST_ACTION };
export type { SftpPostAction };

// ----- Config -----

export interface SftpReceiverConfig extends SftpConnectionOptions {
  readonly remoteDirectory: string;
  readonly filePattern: string;
  readonly pollingIntervalMs: number;
  readonly afterProcessing: SftpPostAction;
  readonly moveToDirectory: string;
  readonly minFileAgeMs: number;
  /** Character encoding of the remote files. Defaults to UTF-8. */
  readonly charset?: string | undefined;
}

// ----- Remote path helper -----

/** Join a remote directory and filename using POSIX ('/') separators. */
export function joinRemote(dir: string, name: string): string {
  const trimmed = dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${trimmed}/${name}`;
}

// ----- Receiver -----

export class SftpReceiver implements SourceConnectorRuntime {
  private readonly config: SftpReceiverConfig;
  private readonly createClient: SftpClientFactory;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /** False once stop or halt is asked for, so a poll cycle in progress takes no more files. */
  private running = false;
  private client: SftpClient | null = null;
  /**
   * Files already dispatched whose pipeline recorded an error or whose
   * post-action (delete/move) failed, keyed by name+modifyTime so they are NOT
   * re-dispatched. Persisted to a remote sidecar ledger.
   */
  private readonly quarantine: QuarantineLedger;

  constructor(config: SftpReceiverConfig, createClient?: SftpClientFactory, logger?: ConnectorLogger) {
    this.config = config;
    this.createClient = createClient ?? createSsh2SftpClient;
    this.logger = logger ?? createConnectorLogger('SFTP');
    this.quarantine = new QuarantineLedger(
      this.remoteLedgerStorage(), joinRemote(config.remoteDirectory, QUARANTINE_LEDGER), this.logger,
    );
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
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
      await this.reconnect();
      // Merge the current and legacy (pre-rename) ledgers, so entries
      // quarantined before the rename are still skipped.
      await this.quarantine.load([
        joinRemote(this.config.remoteDirectory, QUARANTINE_LEDGER),
        joinRemote(this.config.remoteDirectory, LEGACY_QUARANTINE_LEDGER),
      ]);
      this.running = true;
      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.clearPollTimer();
      await this.safeDisconnect();
      this.client = null;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.clearPollTimer();
      await this.safeDisconnect();
      this.client = null;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
      this.client = null;
    });
  }

  /** Execute one poll cycle: list, filter, download, dispatch, post-process. */
  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      if (!this.client) await this.reconnect();
      const entries = await this.listMatchingFiles();
      let failed = false;
      for (const entry of entries) {
        if (!this.running) break;
        // One file that cannot be downloaded (permissions, a file removed
        // mid-poll) must not stop the files after it, this cycle or any later one.
        try {
          await this.processFile(entry);
        } catch (err) {
          failed = true;
          this.logger.error({ ...errorInfo(err), file: entry.name }, 'SFTP file could not be processed; continuing with the next file');
        }
      }
      // The failure may have been the connection: start the next cycle on a fresh one.
      if (failed) {
        await this.safeDisconnect();
        this.client = null;
      }
    } catch (err) {
      // A dropped SFTP connection or vanished directory otherwise leaves the
      // channel STARTED yet silently idle. Surface it and drop the client so
      // the next cycle reconnects.
      this.logger.error(
        { ...errorInfo(err), remoteDirectory: this.config.remoteDirectory },
        'SFTP poll cycle failed; will reconnect',
      );
      await this.safeDisconnect();
      this.client = null;
    } finally {
      this.polling = false;
    }
  }

  /** (Re)establish the SFTP connection. Throws on failure (caught by caller). */
  private async reconnect(): Promise<void> {
    const client = this.createClient(this.config);
    await withTimeout(client.connect(), SFTP_OP_TIMEOUT_MS, 'SFTP connect');
    this.client = client;
  }

  /** List remote entries matching the glob, sorted by name, respecting file age. */
  private async listMatchingFiles(): Promise<readonly SftpFileInfo[]> {
    if (!this.client) return [];
    const entries = await withTimeout(
      this.client.list(this.config.remoteDirectory), SFTP_OP_TIMEOUT_MS, 'SFTP list',
    );
    const now = Date.now();
    const results: SftpFileInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile) continue;
      if (entry.name === QUARANTINE_LEDGER || entry.name === LEGACY_QUARANTINE_LEDGER) continue; // never dispatch a ledger
      if (!matchGlob(this.config.filePattern, entry.name)) continue;
      if (now - entry.modifyTime < this.config.minFileAgeMs) continue; // still being written
      results.push(entry);
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  /** Download a single file, dispatch it, and apply post-processing. */
  private async processFile(entry: SftpFileInfo): Promise<void> {
    if (!this.dispatcher || !this.client) return;

    const key = `${entry.name}:${String(entry.modifyTime)}`;
    if (this.quarantine.has(key)) {
      if (this.quarantine.reportOnce(key)) {
        this.logger.error(
          { file: entry.name },
          'File quarantined after an earlier dispatch; skipping to avoid duplicate delivery (reported once per start)',
        );
      }
      return;
    }

    const remotePath = joinRemote(this.config.remoteDirectory, entry.name);
    const buffer = await withTimeout(this.client.get(remotePath), SFTP_OP_TIMEOUT_MS, 'SFTP get');

    const raw: RawMessage = {
      content: buffer.toString(normalizeEncoding(this.config.charset)),
      sourceMap: {
        originalFilename: entry.name,
        remoteDirectory: this.config.remoteDirectory,
        fileSize: entry.size,
        lastModified: entry.modifyTime,
      },
    };

    const result = await this.dispatcher(raw);
    // Not taken by the pipeline at all: leave the file for the next poll.
    if (!result.ok) return;

    const failure = dispatchFailure(result);
    if (failure !== null) {
      // Recorded with an error. Do not delete or move the file (that would report
      // success), and do not read it again (that would process it twice).
      await this.quarantine.add(key);
      this.logger.error(
        { ...errorInfo(failure), file: entry.name },
        'Pipeline recorded an error for this file; file kept in place and quarantined so it is not read again',
      );
      return;
    }

    try {
      await this.postProcess(entry);
    } catch (err) {
      await this.quarantine.add(key);
      this.logger.error(
        { ...errorInfo(err), file: entry.name },
        'Post-action failed after successful dispatch; quarantining file',
      );
    }
  }

  /** Apply post-processing action to a processed file. */
  private async postProcess(entry: SftpFileInfo): Promise<void> {
    if (!this.client) return;
    const remotePath = joinRemote(this.config.remoteDirectory, entry.name);
    switch (this.config.afterProcessing) {
      case SFTP_POST_ACTION.DELETE:
        await withTimeout(this.client.delete(remotePath), SFTP_OP_TIMEOUT_MS, 'SFTP delete');
        break;
      case SFTP_POST_ACTION.MOVE:
        await withTimeout(this.client.mkdir(this.config.moveToDirectory), SFTP_OP_TIMEOUT_MS, 'SFTP mkdir');
        await withTimeout(
          this.client.rename(remotePath, joinRemote(this.config.moveToDirectory, entry.name)),
          SFTP_OP_TIMEOUT_MS, 'SFTP rename',
        );
        break;
      case SFTP_POST_ACTION.NONE:
        break;
    }
  }

  /**
   * Ledgers in the remote directory, every operation under a timeout. With no
   * client, or when the existence check fails, a ledger reads as absent and a
   * write is skipped.
   */
  private remoteLedgerStorage(): LedgerStorage {
    return {
      read: async (ledgerPath: string): Promise<string | null> => {
        if (!this.client) return null;
        let exists: boolean;
        try {
          exists = await withTimeout(this.client.exists(ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP exists');
        } catch {
          return null;
        }
        if (!exists) return null;
        const buf = await withTimeout(this.client.get(ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP get ledger');
        return buf.toString('utf8');
      },
      write: async (ledgerPath: string, text: string): Promise<void> => {
        if (!this.client) return;
        await withTimeout(this.client.put(Buffer.from(text, 'utf8'), ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP put ledger');
      },
    };
  }

  /** Disconnect the current client, ignoring errors. */
  private async safeDisconnect(): Promise<void> {
    if (!this.client) return;
    try {
      await withTimeout(this.client.end(), SFTP_OP_TIMEOUT_MS, 'SFTP end');
    } catch (err) {
      this.logger.warn(errorInfo(err), 'Error disconnecting SFTP client');
    }
  }

  /** Clear the poll interval timer. */
  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
