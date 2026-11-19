import type { MessageDispatcher, RawMessage } from './base.js';
import { dispatchFailure } from './base.js';
import { errorInfo, type ConnectorLogger } from './logger.js';

export const QUARANTINE_LEDGER_NAME = '.galvanigraph-quarantine.json';

/**
 * Earlier names' ledgers (D-309, D-205): read and merged at start, never written, so a
 * file quarantined before a rename stays quarantined.
 */
export const LEGACY_QUARANTINE_LEDGER_NAMES: readonly string[] = [
  '.galvaniflow-quarantine.json',
  '.mirthless-quarantine.json',
];

export const QUARANTINE_LEDGER_NAMES: readonly string[] = [QUARANTINE_LEDGER_NAME, ...LEGACY_QUARANTINE_LEDGER_NAMES];

export function isQuarantineLedgerName(name: string): boolean {
  return QUARANTINE_LEDGER_NAMES.includes(name);
}

export interface LedgerStorage {
  /** `null` when the ledger does not exist; rejects when it exists but cannot be read. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

export class QuarantineLedger {
  private readonly quarantined = new Set<string>();
  /** Quarantined keys already reported in this run, so each is logged once, not every poll. */
  private readonly reported = new Set<string>();

  /** `ledgerPath` is the one ledger {@link add} writes. */
  constructor(
    private readonly storage: LedgerStorage,
    private readonly ledgerPath: string,
    private readonly logger: ConnectorLogger,
  ) {}

  /** Never throws: a startup read must not crash the connector, so a bad ledger is logged and ignored. */
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

  has(key: string): boolean {
    return this.quarantined.has(key);
  }

  reportOnce(key: string): boolean {
    if (this.reported.has(key)) return false;
    this.reported.add(key);
    return true;
  }

  /**
   * A write failure is only logged: the in-memory set still holds this run, but a
   * restart could re-dispatch, so an operator must know.
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

export interface QuarantinedFile {
  readonly ledger: QuarantineLedger;
  readonly logger: ConnectorLogger;
  /** The file's `name:mtime` quarantine key. */
  readonly key: string;
  /** The file as it appears in the `file` field of every log record. */
  readonly file: string;
  /** `null` skips the file this poll. */
  readonly read: () => Promise<RawMessage | null>;
  readonly dispatcher: MessageDispatcher;
  readonly postProcess: () => Promise<void>;
}

/** Errors from `read` and `dispatcher` propagate. */
export async function dispatchQuarantined(job: QuarantinedFile): Promise<void> {
  const { ledger, logger, key, file } = job;
  if (ledger.has(key)) {
    // Reported once per start, not every poll, so the log stays readable.
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
