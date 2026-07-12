// ===========================================
// File Receiver (Source Connector)
// ===========================================
// Polls a directory for files matching a glob pattern,
// reads each file, dispatches as a message, then applies
// post-processing (delete, move, or leave).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

// ----- Constants -----

const FILE_SORT_BY = {
  NAME: 'NAME',
  DATE: 'DATE',
  SIZE: 'SIZE',
} as const;
type FileSortBy = typeof FILE_SORT_BY[keyof typeof FILE_SORT_BY];

const FILE_POST_ACTION = {
  DELETE: 'DELETE',
  MOVE: 'MOVE',
  NONE: 'NONE',
} as const;
type FilePostAction = typeof FILE_POST_ACTION[keyof typeof FILE_POST_ACTION];

/**
 * Sidecar ledger file (in the watched directory) that persists the quarantine
 * set across restarts. Excluded from polling so it is never dispatched.
 */
const QUARANTINE_LEDGER = '.mirthless-quarantine.json';

// ----- Config -----

export interface FileReceiverConfig {
  readonly directory: string;
  readonly fileFilter: string;
  readonly pollingIntervalMs: number;
  readonly sortBy: FileSortBy;
  readonly charset: BufferEncoding;
  readonly binary: boolean;
  readonly checkFileAge: boolean;
  readonly fileAgeMs: number;
  readonly postAction: FilePostAction;
  readonly moveToDirectory: string;
}

export { FILE_SORT_BY, FILE_POST_ACTION };
export type { FileSortBy, FilePostAction };

// ----- Glob Matching -----

/**
 * Match a filename against a simple glob pattern (supports * and ?).
 * Does NOT support ** or character classes.
 */
export function matchGlob(pattern: string, filename: string): boolean {
  // Convert glob pattern to regex
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      regex += '.*';
    } else if (ch === '?') {
      regex += '.';
    } else if (ch === '.') {
      regex += '\\.';
    } else {
      regex += ch;
    }
  }
  regex += '$';
  return new RegExp(regex, 'i').test(filename);
}

// ----- File Entry -----

interface FileEntry {
  readonly name: string;
  readonly fullPath: string;
  readonly mtime: number;
  readonly size: number;
}

// ----- Receiver -----

export class FileReceiver implements SourceConnectorRuntime {
  private readonly config: FileReceiverConfig;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /**
   * Files that dispatched successfully but whose post-action (delete/move)
   * failed. Tracked by name+mtime so they are NOT re-dispatched next cycle,
   * preventing duplicate message delivery. Requires operator intervention.
   * Persisted to a sidecar ledger in the watched directory so a restart does
   * not re-dispatch an already-dispatched-but-post-action-failed file.
   */
  private readonly quarantined = new Set<string>();
  /** Absolute path to the on-disk quarantine ledger. */
  private readonly ledgerPath: string;

  constructor(config: FileReceiverConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('FILE');
    this.ledgerPath = path.join(config.directory, QUARANTINE_LEDGER);
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.directory) {
        throw new Error('Directory is required');
      }
      if (!this.config.fileFilter) {
        throw new Error('File filter pattern is required');
      }
      if (this.config.pollingIntervalMs < 100) {
        throw new Error('Polling interval must be at least 100ms');
      }
      if (this.config.postAction === FILE_POST_ACTION.MOVE && !this.config.moveToDirectory) {
        throw new Error('Move-to directory is required when postAction is MOVE');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      // Restore the quarantine ledger so files quarantined before a restart are
      // still skipped (never re-dispatched).
      await this.loadQuarantine();

      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  /** Execute one poll cycle: list, filter, read, dispatch, post-process. */
  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      const entries = await this.listMatchingFiles();
      const sorted = this.sortEntries(entries);
      for (const entry of sorted) {
        await this.processFile(entry);
      }
    } catch (err) {
      // Non-fatal (next cycle retries) but MUST be visible: a vanished
      // directory or permission change otherwise leaves the channel STARTED
      // yet silently processing nothing.
      this.logger.error(
        { ...errorInfo(err), directory: this.config.directory },
        'File poll cycle failed',
      );
    } finally {
      this.polling = false;
    }
  }

  /** List directory entries matching the glob and file-age filter. */
  private async listMatchingFiles(): Promise<readonly FileEntry[]> {
    const dirEntries = await fs.readdir(this.config.directory, { withFileTypes: true });
    const now = Date.now();
    const results: FileEntry[] = [];

    for (const entry of dirEntries) {
      if (!entry.isFile()) continue;
      if (entry.name === QUARANTINE_LEDGER) continue; // never dispatch the ledger
      if (!matchGlob(this.config.fileFilter, entry.name)) continue;

      const fullPath = path.join(this.config.directory, entry.name);
      const stat = await fs.stat(fullPath);

      if (this.config.checkFileAge) {
        const age = now - stat.mtimeMs;
        if (age < this.config.fileAgeMs) continue;
      }

      results.push({ name: entry.name, fullPath, mtime: stat.mtimeMs, size: stat.size });
    }
    return results;
  }

  /** Sort file entries by the configured sort criterion. */
  private sortEntries(entries: readonly FileEntry[]): readonly FileEntry[] {
    const copy = [...entries];
    switch (this.config.sortBy) {
      case FILE_SORT_BY.DATE:
        copy.sort((a, b) => a.mtime - b.mtime);
        break;
      case FILE_SORT_BY.SIZE:
        copy.sort((a, b) => a.size - b.size);
        break;
      case FILE_SORT_BY.NAME:
      default:
        copy.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return copy;
  }

  /** Read a single file, dispatch it, and apply post-processing. */
  private async processFile(entry: FileEntry): Promise<void> {
    if (!this.dispatcher) return;

    const key = `${entry.name}:${String(entry.mtime)}`;
    if (this.quarantined.has(key)) {
      // Already dispatched; post-action failed previously. Skip to avoid a
      // duplicate delivery. Surface loudly until an operator resolves it.
      this.logger.error(
        { file: entry.fullPath },
        'File quarantined after post-action failure; skipping to avoid duplicate delivery',
      );
      return;
    }

    const content = this.config.binary
      ? (await fs.readFile(entry.fullPath)).toString('base64')
      : await fs.readFile(entry.fullPath, { encoding: this.config.charset });

    const raw: RawMessage = {
      content,
      sourceMap: {
        originalFilename: entry.name,
        directory: this.config.directory,
        fileSize: entry.size,
        lastModified: entry.mtime,
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
          { ...errorInfo(err), file: entry.fullPath },
          'Post-action failed after successful dispatch; quarantining file',
        );
      }
    }
  }

  /**
   * Load the quarantine ledger from disk into memory. Resilient: a missing
   * ledger means an empty set; a corrupt ledger is logged and treated as empty
   * (a startup read must never crash the connector).
   */
  private async loadQuarantine(): Promise<void> {
    let raw: unknown;
    try {
      raw = await fs.readFile(this.ledgerPath, { encoding: 'utf8' });
    } catch {
      return; // no ledger yet — nothing quarantined
    }
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    // The ledger is always a JSON array. Anything else is either absent or not
    // ours — do not treat it as corruption.
    if (!trimmed.startsWith('[')) return;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const key of parsed) {
          if (typeof key === 'string') this.quarantined.add(key);
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
   * Persist the quarantine set to the sidecar ledger. A write failure is logged
   * loudly: the in-memory guard still holds this session, but a restart could
   * re-dispatch, so an operator must know.
   */
  private async persistQuarantine(): Promise<void> {
    try {
      await fs.writeFile(this.ledgerPath, JSON.stringify([...this.quarantined]), { encoding: 'utf8' });
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: this.ledgerPath },
        'Failed to persist quarantine ledger; quarantine will not survive a restart',
      );
    }
  }

  /** Apply post-processing action to a processed file. */
  private async postProcess(entry: FileEntry): Promise<void> {
    switch (this.config.postAction) {
      case FILE_POST_ACTION.DELETE:
        await fs.unlink(entry.fullPath);
        break;
      case FILE_POST_ACTION.MOVE:
        await fs.mkdir(this.config.moveToDirectory, { recursive: true });
        await fs.rename(entry.fullPath, path.join(this.config.moveToDirectory, entry.name));
        break;
      case FILE_POST_ACTION.NONE:
        break;
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
