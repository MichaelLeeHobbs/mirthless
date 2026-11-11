// ===========================================
// File Receiver (Source Connector)
// ===========================================
// Polls a directory for files matching a glob pattern,
// reads each file, dispatches as a message, then applies
// post-processing (delete, move, or leave).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tryCatch, type Result } from '@galvaniflow/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { normalizeEncoding, isKnownEncoding, unknownEncodingMessage } from '../encoding.js';
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
const QUARANTINE_LEDGER = '.galvaniflow-quarantine.json';
/**
 * Ledger name used before the GalvaniFlow rename. Still read (merged into the
 * set) and never dispatched, but never written: the next persist carries its
 * entries into {@link QUARANTINE_LEDGER}.
 */
const LEGACY_QUARANTINE_LEDGER = '.mirthless-quarantine.json';

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
  // Convert glob pattern to regex. Every non-wildcard character is escaped, so a
  // filter like `report(1)*.hl7` or `data[0]*.txt` produces a valid regex instead
  // of throwing on `new RegExp` every poll cycle (which silently wedged the channel).
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      regex += '.*';
    } else if (ch === '?') {
      regex += '.';
    } else if (/[.\\+^$(){}|[\]]/.test(ch)) {
      regex += `\\${ch}`;
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
  /** False once stop or halt is requested: the cycle in flight takes no more files. */
  private running = false;
  /** The poll cycle in flight, so stop can wait for the file being processed. */
  private cycle: Promise<void> | null = null;
  /**
   * Files that dispatched successfully but whose post-action (delete/move)
   * failed. Tracked by name+mtime so they are NOT re-dispatched next cycle,
   * preventing duplicate message delivery. Requires operator intervention.
   * Persisted to a sidecar ledger in the watched directory so a restart does
   * not re-dispatch an already-dispatched-but-post-action-failed file.
   */
  private readonly quarantined = new Set<string>();
  /** Quarantined files already reported in this run. */
  private readonly quarantineReported = new Set<string>();
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
      if (!this.config.binary && !isKnownEncoding(this.config.charset)) {
        throw new Error(unknownEncodingMessage(this.config.charset));
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

      this.running = true;
      this.pollTimer = setInterval(() => {
        if (this.polling) return;
        this.cycle = this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  /** Stop taking files and wait for the one being processed to finish. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.clearPollTimer();
      if (this.cycle !== null) await this.cycle;
    });
  }

  /** Stop taking files without waiting for the one being processed. */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
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
        if (!this.running) break;
        // One file that cannot be read (permissions, a file removed mid-poll)
        // must not stop the files after it, this cycle or any later one.
        try {
          await this.processFile(entry);
        } catch (err) {
          this.logger.error({ ...errorInfo(err), file: entry.fullPath }, 'File could not be processed; continuing with the next file');
        }
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
      if (entry.name === QUARANTINE_LEDGER || entry.name === LEGACY_QUARANTINE_LEDGER) continue; // never dispatch a ledger
      if (!matchGlob(this.config.fileFilter, entry.name)) continue;

      const fullPath = path.join(this.config.directory, entry.name);
      const stat = await fs.stat(fullPath).catch(() => null);
      // Gone since the listing (another reader took it): nothing to process.
      if (stat === null) continue;

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
      // Already dispatched: its post-action failed, or the pipeline recorded an
      // error for it. Skip to avoid a duplicate delivery. Reported once per
      // start, not on every poll, so the log stays readable.
      if (!this.quarantineReported.has(key)) {
        this.quarantineReported.add(key);
        this.logger.error(
          { file: entry.fullPath },
          'File quarantined after an earlier dispatch; skipping to avoid duplicate delivery (reported once per start)',
        );
      }
      return;
    }

    const content = await this.readContent(entry);
    if (content === null) return;

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
    // Not taken by the pipeline at all: leave the file for the next poll.
    if (!result.ok) return;

    const failure = dispatchFailure(result);
    if (failure !== null) {
      // Recorded with an error. Do not delete or move the file (that would report
      // success), and do not read it again (that would process it twice).
      this.quarantined.add(key);
      await this.persistQuarantine();
      this.logger.error(
        { ...errorInfo(failure), file: entry.fullPath },
        'Pipeline recorded an error for this file; file kept in place and quarantined so it is not read again',
      );
      return;
    }

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

  /**
   * Read one file. A file that cannot be read is reported and skipped, so it
   * does not hold up the files after it; it is tried again on the next poll.
   */
  private async readContent(entry: FileEntry): Promise<string | null> {
    try {
      return this.config.binary
        ? (await fs.readFile(entry.fullPath)).toString('base64')
        : await fs.readFile(entry.fullPath, { encoding: normalizeEncoding(this.config.charset) });
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: entry.fullPath },
        'File could not be read; skipping it this poll and continuing with the next file',
      );
      return null;
    }
  }

  /**
   * Load the current and legacy quarantine ledgers from disk and merge them
   * into memory, so entries quarantined before the rename are still skipped.
   */
  private async loadQuarantine(): Promise<void> {
    await this.loadLedgerFile(this.ledgerPath);
    await this.loadLedgerFile(path.join(this.config.directory, LEGACY_QUARANTINE_LEDGER));
  }

  /**
   * Add one ledger file's keys to the quarantine set. Resilient: a missing
   * ledger adds nothing; a corrupt ledger is logged and ignored (a startup read
   * must never crash the connector).
   */
  private async loadLedgerFile(ledgerPath: string): Promise<void> {
    let raw: unknown;
    try {
      raw = await fs.readFile(ledgerPath, { encoding: 'utf8' });
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
        { ...errorInfo(err), file: ledgerPath },
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
