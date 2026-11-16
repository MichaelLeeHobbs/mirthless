// ===========================================
// File Receiver (Source Connector)
// ===========================================
// Polls a directory for files matching a glob pattern,
// reads each file, dispatches as a message, then applies
// post-processing (delete, move, or leave).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { normalizeEncoding, isKnownEncoding, unknownEncodingMessage } from '../encoding.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import {
  QUARANTINE_LEDGER_NAME,
  QUARANTINE_LEDGER_NAMES,
  QuarantineLedger,
  dispatchQuarantined,
  isQuarantineLedgerName,
  type LedgerStorage,
} from '../quarantine-ledger.js';
import { resolveWithinRoots, type FileRoots } from './file-roots.js';

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

/** Ledgers on the local filesystem. A missing ledger (ENOENT) reads as absent. */
const LOCAL_LEDGER_STORAGE: LedgerStorage = {
  async read(ledgerPath: string): Promise<string | null> {
    try {
      return await fs.readFile(ledgerPath, { encoding: 'utf8' });
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null; // no ledger yet
      throw err;
    }
  },
  async write(ledgerPath: string, text: string): Promise<void> {
    await fs.writeFile(ledgerPath, text, { encoding: 'utf8' });
  },
};

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
  /** Leave names starting with `.` alone, as a Mirth File Reader does by default. */
  readonly ignoreDot: boolean;
  /** Where the directory and move-to directory may be (FILE_CONNECTOR_ROOTS, D-314). */
  readonly roots: FileRoots;
}

export { FILE_SORT_BY, FILE_POST_ACTION };
export type { FileSortBy, FilePostAction };

// ----- Glob Matching -----

/**
 * Match a filename against a simple glob pattern (supports * and ?).
 * Does NOT support ** or character classes. Case-sensitive on every platform,
 * as a Mirth File Reader's filter is (D-304): `*.hl7` does not match `A.HL7`.
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
  return new RegExp(regex).test(filename);
}

/**
 * Whether a polling file source takes a file by its name: the glob matches and,
 * with `ignoreDot`, the name does not start with a dot. The File and SFTP
 * sources both use it, so they pick the files a Mirth File Reader would.
 */
export function selectsFileName(name: string, pattern: string, ignoreDot: boolean): boolean {
  if (ignoreDot && name.startsWith('.')) return false;
  return matchGlob(pattern, name);
}

/**
 * Mirth's hold-back sentinel: while `<name>.ignore` exists, `<name>` is not
 * read, and a name ending in `.ignore` is never read itself.
 */
const IGNORE_SUFFIX = '.ignore';

/** True when the name is a `.ignore` sentinel or one sits next to it in the listing. */
function heldBack(name: string, listed: ReadonlySet<string>): boolean {
  return name.endsWith(IGNORE_SUFFIX) || listed.has(name + IGNORE_SUFFIX);
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
   * Files already dispatched whose pipeline recorded an error or whose
   * post-action (delete/move) failed, keyed by name+mtime so they are NOT
   * re-dispatched. Requires operator intervention. Persisted to a sidecar
   * ledger in the watched directory so a restart does not re-dispatch them.
   */
  private readonly quarantine: QuarantineLedger;

  constructor(config: FileReceiverConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('FILE');
    this.quarantine = new QuarantineLedger(
      LOCAL_LEDGER_STORAGE, path.join(config.directory, QUARANTINE_LEDGER_NAME), this.logger,
    );
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
      await resolveWithinRoots(this.config.directory, this.config.roots);
      if (this.config.postAction === FILE_POST_ACTION.MOVE) {
        await resolveWithinRoots(this.config.moveToDirectory, this.config.roots);
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      // Restore the current and legacy (pre-rename) quarantine ledgers so files
      // quarantined before a restart are still skipped (never re-dispatched).
      await this.quarantine.load(QUARANTINE_LEDGER_NAMES.map((name) => path.join(this.config.directory, name)));

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

  /**
   * List directory entries matching the glob and file-age filter. The directory
   * is checked against the roots on every poll: it may have been replaced by a
   * symlink since deploy. Symlinked files in it are skipped (`isFile` is false
   * for a link), so each file read is the directory's own.
   */
  private async listMatchingFiles(): Promise<readonly FileEntry[]> {
    const directory = await resolveWithinRoots(this.config.directory, this.config.roots);
    const dirEntries = await fs.readdir(directory, { withFileTypes: true });
    const listed = new Set(dirEntries.map((e) => e.name));
    const now = Date.now();
    const results: FileEntry[] = [];

    for (const entry of dirEntries) {
      if (!entry.isFile() || !this.takesName(entry.name, listed)) continue;

      const fullPath = path.join(directory, entry.name);
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

  /** Whether a listed name is one to read: not a ledger, not held back, and selected by the filter. */
  private takesName(name: string, listed: ReadonlySet<string>): boolean {
    if (isQuarantineLedgerName(name)) return false; // never dispatch a ledger
    if (heldBack(name, listed)) return false;
    return selectsFileName(name, this.config.fileFilter, this.config.ignoreDot);
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
    await dispatchQuarantined({
      ledger: this.quarantine,
      logger: this.logger,
      key: `${entry.name}:${String(entry.mtime)}`,
      file: entry.fullPath,
      read: () => this.readMessage(entry),
      dispatcher: this.dispatcher,
      postProcess: () => this.postProcess(entry),
    });
  }

  /**
   * Read one file into a message. A file that cannot be read is reported and
   * skipped, so it does not hold up the files after it; it is tried again on
   * the next poll.
   */
  private async readMessage(entry: FileEntry): Promise<RawMessage | null> {
    let content: string;
    try {
      content = this.config.binary
        ? (await fs.readFile(entry.fullPath)).toString('base64')
        : await fs.readFile(entry.fullPath, { encoding: normalizeEncoding(this.config.charset) });
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: entry.fullPath },
        'File could not be read; skipping it this poll and continuing with the next file',
      );
      return null;
    }
    return {
      content,
      sourceMap: {
        originalFilename: entry.name,
        directory: this.config.directory,
        fileSize: entry.size,
        lastModified: entry.mtime,
      },
    };
  }

  /** Apply post-processing action to a processed file. */
  private async postProcess(entry: FileEntry): Promise<void> {
    switch (this.config.postAction) {
      case FILE_POST_ACTION.DELETE:
        await fs.unlink(entry.fullPath);
        break;
      case FILE_POST_ACTION.MOVE: {
        const target = await resolveWithinRoots(this.config.moveToDirectory, this.config.roots);
        await fs.mkdir(target, { recursive: true });
        await fs.rename(entry.fullPath, path.join(target, entry.name));
        break;
      }
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
