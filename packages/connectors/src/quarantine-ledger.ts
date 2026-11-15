// ===========================================
// Quarantine Ledger (File and SFTP sources)
// ===========================================
// A polling source quarantines a file it dispatched when the pipeline recorded
// an error for it or its post-action (delete/move) failed, so the file is never
// delivered twice. The quarantine set is kept as a JSON array of `name:mtime`
// keys in a sidecar ledger next to the files, and loaded again at start so a
// restart does not re-dispatch. Each receiver supplies the storage (local fs or
// a remote SFTP client); this module owns the set, its parsing and its logging.

import { errorInfo, type ConnectorLogger } from './logger.js';

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
