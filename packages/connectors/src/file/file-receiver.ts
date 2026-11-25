import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stderr, tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, SourceHealthHandler, MessageDispatcher, RawMessage } from '../base.js';
import { normalizeEncoding, isKnownEncoding, unknownEncodingMessage } from '../encoding.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
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
import { isTempFileName } from '../temp-file.js';
import { moveWithoutReplacing } from './file-move.js';
import { isMissing, resolveWithinRoots, type FileRoots } from './file-roots.js';

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

const LOCAL_LEDGER_STORAGE: LedgerStorage = {
  async read(ledgerPath: string): Promise<string | null> {
    try {
      return await fs.readFile(ledgerPath, { encoding: 'utf8' });
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async write(ledgerPath: string, text: string): Promise<void> {
    await fs.writeFile(ledgerPath, text, { encoding: 'utf8' });
  },
};

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
  /** Where the directory and move-to directory may be (FILE_CONNECTOR_ROOTS, D-315). */
  readonly roots: FileRoots;
}

export { FILE_SORT_BY, FILE_POST_ACTION };
export type { FileSortBy, FilePostAction };

/**
 * `*` and `?` only, no `**` or character classes. Case-sensitive on every platform,
 * as a Mirth File Reader's filter is (D-304).
 */
export function matchGlob(pattern: string, filename: string): boolean {
  // Escape every other character: `report(1)*.hl7` threw on every poll and silently wedged the channel.
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

/** Shared by the File and SFTP sources, so both pick the files a Mirth File Reader would. */
export function selectsFileName(name: string, pattern: string, ignoreDot: boolean): boolean {
  if (isTempFileName(name)) return false;
  if (ignoreDot && name.startsWith('.')) return false;
  return matchGlob(pattern, name);
}

/**
 * Mirth's hold-back sentinel: while `<name>.ignore` exists, `<name>` is not
 * read, and a name ending in `.ignore` is never read itself.
 */
const IGNORE_SUFFIX = '.ignore';

function heldBack(name: string, listed: ReadonlySet<string>): boolean {
  return name.endsWith(IGNORE_SUFFIX) || listed.has(name + IGNORE_SUFFIX);
}

const LISTING_LATE_MS = 60_000;

interface FileEntry extends FileVersion {
  readonly name: string;
  readonly fullPath: string;
}

async function versionOf(fullPath: string): Promise<FileVersion | null> {
  try {
    const stat = await fs.stat(fullPath);
    return { modifyTime: stat.mtimeMs, size: stat.size };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

export class FileReceiver implements SourceConnectorRuntime {
  private readonly config: FileReceiverConfig;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private health: SourceHealthHandler = () => undefined;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /** False once stop or halt is requested: the cycle in flight takes no more files. */
  private running = false;
  /** When the listing under way last went on. */
  private listingSince: number | null = null;
  private lateListingLogged = false;
  /** The poll cycle in flight, so stop can wait for the file being processed. */
  private cycle: Promise<void> | null = null;
  /**
   * Dispatched files whose pipeline recorded an error or whose post-action failed,
   * keyed by name+mtime: never re-dispatched, even after a restart. Needs an operator.
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

  setHealthHandler(handler: SourceHealthHandler): void {
    this.health = handler;
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

      // Pre-rename ledger names too, so files quarantined before a restart stay skipped.
      await this.quarantine.load(QUARANTINE_LEDGER_NAMES.map((name) => path.join(this.config.directory, name)));

      this.running = true;
      this.pollTimer = setInterval(() => {
        if (this.polling) {
          this.reportLateListing();
          return;
        }
        this.cycle = this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.clearPollTimer();
      if (this.cycle !== null) await this.cycle;
    });
  }

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

  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      this.listingSince = Date.now();
      this.lateListingLogged = false;
      const entries = await this.listMatchingFiles();
      this.listingSince = null;
      this.reportHealth(null);
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
      // The next cycle retries, but log it: otherwise a vanished directory leaves
      // the channel STARTED yet silently processing nothing.
      this.logger.error(
        { ...errorInfo(err), directory: this.config.directory },
        'File poll cycle failed',
      );
      this.reportHealth(stderr(err));
    } finally {
      this.listingSince = null;
      this.polling = false;
    }
  }

  /** A mount that is gone can hang the listing for ever. Another one beside it would take up one more thread. */
  private reportLateListing(): void {
    if (this.listingSince === null || Date.now() - this.listingSince < LISTING_LATE_MS) return;
    const failure = new Error(`Listing the directory has not gone on for ${String(LISTING_LATE_MS / 1_000)} s`);
    if (!this.lateListingLogged) this.logger.error({ ...errorInfo(failure), directory: this.config.directory }, 'File poll hangs; no other is begun beside it');
    this.lateListingLogged = true;
    this.reportHealth(failure);
  }

  private reportHealth(failure: Error | null): void {
    if (this.running) this.health(failure);
  }

  /**
   * Checks the roots every poll: the directory may have become a symlink since deploy.
   * Symlinked files are skipped (`isFile` is false for a link).
   */
  private async listMatchingFiles(): Promise<readonly FileEntry[]> {
    const directory = await resolveWithinRoots(this.config.directory, this.config.roots);
    const dirEntries = await fs.readdir(directory, { withFileTypes: true });
    this.listingSince = Date.now();
    const listed = new Set(dirEntries.map((e) => e.name));
    const results: FileEntry[] = [];
    let failure: unknown = null;
    const unseen: string[] = [];
    let seen = 0;

    for (const entry of dirEntries) {
      if (!entry.isFile() || !this.takesName(entry.name, listed)) continue;

      const fullPath = path.join(directory, entry.name);
      const version = await versionOf(fullPath).then((found) => { seen += 1; return found; }, (err: unknown) => {
        failure ??= err;
        unseen.push(fullPath);
        return null;
      });
      this.listingSince = Date.now();
      // Gone since the listing (another reader took it): nothing to process.
      if (version === null || isTooNew(version, this.minAgeMs())) continue;

      results.push({ name: entry.name, fullPath, ...version });
    }
    if (unseen.length > 0) {
      this.logger.error({ ...errorInfo(failure), files: unseen.length, file: unseen[0] }, 'Files could not be looked at; skipping them this poll');
      if (seen === 0) throw failure;
    }
    return results;
  }

  private minAgeMs(): number | null {
    return this.config.checkFileAge ? this.config.fileAgeMs : null;
  }

  private takesName(name: string, listed: ReadonlySet<string>): boolean {
    if (isQuarantineLedgerName(name)) return false;
    if (heldBack(name, listed)) return false;
    return selectsFileName(name, this.config.fileFilter, this.config.ignoreDot);
  }

  private sortEntries(entries: readonly FileEntry[]): readonly FileEntry[] {
    const copy = [...entries];
    switch (this.config.sortBy) {
      case FILE_SORT_BY.DATE:
        copy.sort((a, b) => a.modifyTime - b.modifyTime);
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

  private async processFile(entry: FileEntry): Promise<void> {
    if (!this.dispatcher) return;
    await dispatchQuarantined({
      ledger: this.quarantine,
      logger: this.logger,
      name: entry.name,
      listed: entry,
      file: entry.fullPath,
      minAgeMs: this.minAgeMs(),
      version: () => versionOf(entry.fullPath),
      read: (version) => this.readMessage(entry, version),
      dispatcher: this.dispatcher,
      postProcess: this.config.postAction === FILE_POST_ACTION.NONE ? null : () => this.postProcess(entry),
    });
  }

  /** Null for an unreadable file: reported and skipped, then tried again next poll. */
  private async readMessage(entry: FileEntry, version: FileVersion): Promise<RawMessage | null> {
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
        fileSize: version.size,
        lastModified: version.modifyTime,
      },
    };
  }

  private async postProcess(entry: FileEntry): Promise<void> {
    switch (this.config.postAction) {
      case FILE_POST_ACTION.DELETE:
        await fs.unlink(entry.fullPath);
        break;
      case FILE_POST_ACTION.MOVE: {
        const target = await resolveWithinRoots(this.config.moveToDirectory, this.config.roots);
        await fs.mkdir(target, { recursive: true });
        await moveWithoutReplacing(entry.fullPath, path.join(target, entry.name));
        break;
      }
      case FILE_POST_ACTION.NONE:
        break;
    }
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
