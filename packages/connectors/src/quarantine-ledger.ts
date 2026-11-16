// ===========================================
// Quarantine Ledger (File and SFTP sources)
// ===========================================
// A polling source quarantines a file it dispatched when the pipeline recorded
// an error for it or its post-action (delete/move) failed, so the file is never
// delivered twice. The quarantine set is kept as a JSON array of `name:mtime`
// keys in a sidecar ledger next to the files, and loaded again at start so a
// restart does not re-dispatch. Each receiver supplies the storage (local fs or
// a remote SFTP client); this module owns the set, its parsing and its logging.

import type { MessageDispatcher, RawMessage } from './base.js';
import { dispatchFailure } from './base.js';
import { errorInfo, type ConnectorLogger } from './logger.js';

/** The ledger file a source writes in its watched directory. */
export const QUARANTINE_LEDGER_NAME = '.galvanigraph-quarantine.json';

/**
 * Ledger files written under the product's earlier names: GalvaniFlow (D-309)
 * and Mirthless (D-205). Still read and merged at start, never written, so a
 * file quarantined before a rename stays quarantined. The next persist carries
 * their entries into {@link QUARANTINE_LEDGER_NAME}.
 */
export const LEGACY_QUARANTINE_LEDGER_NAMES: readonly string[] = [
  '.galvaniflow-quarantine.json',
  '.mirthless-quarantine.json',
];

/** Every ledger file a source loads at start, current first. */
export const QUARANTINE_LEDGER_NAMES: readonly string[] = [QUARANTINE_LEDGER_NAME, ...LEGACY_QUARANTINE_LEDGER_NAMES];

/** True when a file name is a current or legacy ledger, which is never dispatched. */
export function isQuarantineLedgerName(name: string): boolean {
  return QUARANTINE_LEDGER_NAMES.includes(name);
}

/** Where a receiver keeps its ledger files. */
export interface LedgerStorage {
  /**
   * Read a ledger's text. Resolves `null` when the ledger does not exist;
   * rejects when it exists but cannot be read.
   */
  read(path: string): Promise<string | null>;
  /** Replace a ledger's text. */
  write(path: string, text: string): Promise<void>;
}

/** The quarantined keys of one watched directory, persisted to its ledger. */
export class QuarantineLedger {
  private readonly quarantined = new Set<string>();
  /** Quarantined keys already reported in this run, so each is logged once, not every poll. */
  private readonly reported = new Set<string>();

  /**
   * @param storage - Reads and writes the ledger files.
   * @param ledgerPath - The ledger that {@link add} writes.
   * @param logger - Receives read, parse and write failures.
   */
  constructor(
    private readonly storage: LedgerStorage,
    private readonly ledgerPath: string,
    private readonly logger: ConnectorLogger,
  ) {}

  /**
   * Merge the keys of each ledger into the set. Never throws: a missing ledger
   * adds nothing, and an unreadable or corrupt one is logged and ignored (a
   * startup read must never crash the connector).
   */
  async load(paths: readonly string[]): Promise<void> {
    for (const ledgerPath of paths) {
      let text: string | null;
      try {
        text = await this.storage.read(ledgerPath);
      } catch (err) {
        this.logger.error(
          { ...errorInfo(err), file: ledgerPath },
          'Failed to read quarantine ledger; ignoring it (files may be re-dispatched)',
        );
        continue;
      }
      if (text !== null) this.parse(text.trim(), ledgerPath);
    }
  }

  /** True when the key is quarantined. */
  has(key: string): boolean {
    return this.quarantined.has(key);
  }

  /** True the first time it is called for a key in this run, false after. */
  reportOnce(key: string): boolean {
    if (this.reported.has(key)) return false;
    this.reported.add(key);
    return true;
  }

  /**
   * Quarantine a key and persist the whole set. A write failure is logged
   * loudly: the in-memory guard still holds this session, but a restart could
   * re-dispatch, so an operator must know.
   */
  async add(key: string): Promise<void> {
    this.quarantined.add(key);
    try {
      await this.storage.write(this.ledgerPath, JSON.stringify([...this.quarantined]));
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: this.ledgerPath },
        'Failed to persist quarantine ledger; quarantine will not survive a restart',
      );
    }
  }

  /** Add the string keys of a ledger's JSON array; corruption is logged, not fatal. */
  private parse(text: string, ledgerPath: string): void {
    // The ledger is always a JSON array. Anything else is not ours: do not
    // treat it as corruption.
    if (!text.startsWith('[')) return;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return;
      for (const key of parsed) {
        if (typeof key === 'string') this.quarantined.add(key);
      }
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), file: ledgerPath },
        'Quarantine ledger is corrupt; ignoring it (files may be re-dispatched)',
      );
    }
  }
}

/** One polled file to dispatch under quarantine. */
export interface QuarantinedFile {
  readonly ledger: QuarantineLedger;
  readonly logger: ConnectorLogger;
  /** The file's `name:mtime` quarantine key. */
  readonly key: string;
  /** The file as it appears in the `file` field of every log record. */
  readonly file: string;
  /** Read the file into a message; `null` skips it this poll. */
  readonly read: () => Promise<RawMessage | null>;
  readonly dispatcher: MessageDispatcher;
  /** Apply the configured delete or move after a clean dispatch. */
  readonly postProcess: () => Promise<void>;
}

/**
 * Dispatch one polled file unless it is quarantined. A file the pipeline
 * recorded an error for, or whose post-action fails, is quarantined so it is
 * never read again. Errors from `read` and `dispatcher` propagate.
 */
export async function dispatchQuarantined(job: QuarantinedFile): Promise<void> {
  const { ledger, logger, key, file } = job;
  if (ledger.has(key)) {
    // Already dispatched: its post-action failed, or the pipeline recorded an
    // error for it. Skip to avoid a duplicate delivery. Reported once per
    // start, not on every poll, so the log stays readable.
    if (ledger.reportOnce(key)) {
      logger.error(
        { file },
        'File quarantined after an earlier dispatch; skipping to avoid duplicate delivery (reported once per start)',
      );
    }
    return;
  }

  const raw = await job.read();
  if (raw === null) return;

  const result = await job.dispatcher(raw);
  // Not taken by the pipeline at all: leave the file for the next poll.
  if (!result.ok) return;

  const failure = dispatchFailure(result);
  if (failure !== null) {
    // Recorded with an error. Do not delete or move the file (that would report
    // success), and do not read it again (that would process it twice).
    await ledger.add(key);
    logger.error(
      { ...errorInfo(failure), file },
      'Pipeline recorded an error for this file; file kept in place and quarantined so it is not read again',
    );
    return;
  }

  try {
    await job.postProcess();
  } catch (err) {
    await ledger.add(key);
    logger.error({ ...errorInfo(err), file }, 'Post-action failed after successful dispatch; quarantining file');
  }
}
