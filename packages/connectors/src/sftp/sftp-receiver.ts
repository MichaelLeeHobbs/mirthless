// ===========================================
// SFTP Receiver (Source Connector)
// ===========================================
// Polls a remote SFTP directory for files matching a glob pattern, downloads
// each, dispatches its content as a message, then applies post-processing
// (delete, move, or leave). Mirrors the File connector: reentrancy guard,
// file-age skip, durable quarantine, and loud poll-cycle logging. The
// quarantine ledger lives as a sidecar in the remote directory so a restart
// (new instance) does not re-dispatch an already-dispatched file.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { matchGlob } from '../file/file-receiver.js';
import { withTimeout } from '../timeout.js';
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
const QUARANTINE_LEDGER = '.mirthless-quarantine.json';

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
  private client: SftpClient | null = null;
  /**
   * Files that dispatched successfully but whose post-action (delete/move)
   * failed. Tracked by name+modifyTime so they are NOT re-dispatched next
   * cycle, preventing duplicate delivery. Persisted to a remote sidecar ledger.
   */
  private readonly quarantined = new Set<string>();
  private readonly ledgerPath: string;

  constructor(config: SftpReceiverConfig, createClient?: SftpClientFactory, logger?: ConnectorLogger) {
    this.config = config;
    this.createClient = createClient ?? createSsh2SftpClient;
    this.logger = logger ?? createConnectorLogger('SFTP');
    this.ledgerPath = joinRemote(config.remoteDirectory, QUARANTINE_LEDGER);
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
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }
      await this.reconnect();
      await this.loadQuarantine();
      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
      await this.safeDisconnect();
      this.client = null;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
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
      for (const entry of entries) {
        await this.processFile(entry);
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
      if (entry.name === QUARANTINE_LEDGER) continue; // never dispatch the ledger
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
    if (this.quarantined.has(key)) {
      this.logger.error(
        { file: entry.name },
        'File quarantined after post-action failure; skipping to avoid duplicate delivery',
      );
      return;
    }

    const remotePath = joinRemote(this.config.remoteDirectory, entry.name);
    const buffer = await withTimeout(this.client.get(remotePath), SFTP_OP_TIMEOUT_MS, 'SFTP get');

    const raw: RawMessage = {
      content: buffer.toString('utf8'),
      sourceMap: {
        originalFilename: entry.name,
        remoteDirectory: this.config.remoteDirectory,
        fileSize: entry.size,
        lastModified: entry.modifyTime,
      },
    };

    const result = await this.dispatcher(raw);

    if (result.ok) {
      try {
        await this.postProcess(entry);
      } catch (err) {
        this.quarantined.add(key);
        await this.persistQuarantine();
        this.logger.error(
          { ...errorInfo(err), file: entry.name },
          'Post-action failed after successful dispatch; quarantining file',
        );
      }
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
   * Load the quarantine ledger from the remote sidecar into memory. Resilient:
   * a missing ledger means an empty set; a corrupt ledger is logged and treated
   * as empty (a startup read must never crash the connector).
   */
  private async loadQuarantine(): Promise<void> {
    if (!this.client) return;
    let exists: boolean;
    try {
      exists = await withTimeout(this.client.exists(this.ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP exists');
    } catch {
      return;
    }
    if (!exists) return;
    let text: string;
    try {
      const buf = await withTimeout(this.client.get(this.ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP get ledger');
      text = buf.toString('utf8').trim();
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: this.ledgerPath },
        'Failed to read quarantine ledger; ignoring it (files may be re-dispatched)',
      );
      return;
    }
    if (!text.startsWith('[')) return;
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const k of parsed) {
          if (typeof k === 'string') this.quarantined.add(k);
        }
      }
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: this.ledgerPath },
        'Quarantine ledger is corrupt; ignoring it (files may be re-dispatched)',
      );
    }
  }

  /**
   * Persist the quarantine set to the remote sidecar ledger. A write failure is
   * logged loudly: the in-memory guard still holds this session, but a restart
   * could re-dispatch, so an operator must know.
   */
  private async persistQuarantine(): Promise<void> {
    if (!this.client) return;
    try {
      const data = Buffer.from(JSON.stringify([...this.quarantined]), 'utf8');
      await withTimeout(this.client.put(data, this.ledgerPath), SFTP_OP_TIMEOUT_MS, 'SFTP put ledger');
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: this.ledgerPath },
        'Failed to persist quarantine ledger; quarantine will not survive a restart',
      );
    }
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
