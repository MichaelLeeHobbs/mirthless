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

/** What tells one version of a file from the next. */
export interface FileVersion {
  readonly modifyTime: number;
  readonly size: number;
}

export interface QuarantinedFile {
  readonly ledger: QuarantineLedger;
  readonly logger: ConnectorLogger;
  readonly name: string;
  /** The file as the folder listing had it. */
  readonly listed: FileVersion;
  /** The file as it appears in the `file` field of every log record. */
  readonly file: string;
  /** How old a file must be to be read; `null` when its age is not checked. */
  readonly minAgeMs: number | null;
  /** The file as it is now; `null` when it is gone. */
  readonly version: () => Promise<FileVersion | null>;
  /** `null` skips the file this poll. */
  readonly read: (version: FileVersion) => Promise<RawMessage | null>;
  readonly dispatcher: MessageDispatcher;
  /** True once the source takes no more files: one that was only read stays for the next start. */
  readonly stopped?: () => boolean;
  /** `null` leaves the file where it is, to be read again. */
  readonly postProcess: (() => Promise<void>) | null;
}

/** A listing may have been taken long before the file's turn, so its age is checked again when it is read. */
export function isTooNew(version: FileVersion, minAgeMs: number | null): boolean {
  return minAgeMs !== null && Date.now() - version.modifyTime < minAgeMs;
}

/** `Object.is`, because an SFTP server may send no time, which reads as NaN. */
function sameVersion(a: FileVersion, b: FileVersion): boolean {
  return Object.is(a.modifyTime, b.modifyTime) && a.size === b.size;
}

function quarantineKey(name: string, version: FileVersion): string {
  return `${name}:${String(version.modifyTime)}`;
}

function skipsQuarantined(job: QuarantinedFile, version: FileVersion): boolean {
  const key = quarantineKey(job.name, version);
  if (!job.ledger.has(key)) return false;
  // Reported once per start, not every poll, so the log stays readable.
  if (job.ledger.reportOnce(key)) {
    job.logger.error(
      { file: job.file },
      'File quarantined after an earlier dispatch; skipping to avoid duplicate delivery (reported once per start)',
    );
  }
  return true;
}

interface ReadFile {
  readonly raw: RawMessage;
  readonly version: FileVersion;
  /** What was read is all there is. */
  readonly gone: boolean;
}

/** `null` when the file is not to be dispatched this poll. */
async function readWhole(job: QuarantinedFile): Promise<ReadFile | null> {
  if (skipsQuarantined(job, job.listed)) return null;
  const version = await job.version();
  if (version === null) throw new Error('The file is gone');
  if (!sameVersion(version, job.listed)) {
    if (isTooNew(version, job.minAgeMs)) {
      job.logger.info({ file: job.file }, 'File changed since it was listed and is too new to read; left for a later poll');
      return null;
    }
    if (skipsQuarantined(job, version)) return null;
  }
  const raw = await job.read(version);
  if (raw === null) return null;
  const after = await job.version();
  if (after === null) {
    // A pick-up folder's server takes a file away once it was downloaded.
    job.logger.warn({ file: job.file }, 'File was gone once it was read; processing what was read');
  } else if (!sameVersion(after, version)) {
    job.logger.warn({ file: job.file }, 'File changed while it was read; left for a later poll');
    return null;
  }
  return { raw, version, gone: after === null };
}

async function settle(job: QuarantinedFile, postProcess: () => Promise<void>, version: FileVersion): Promise<void> {
  const { ledger, logger, name, file } = job;
  try {
    const now = await job.version();
    if (now === null) throw new Error('The file is gone');
    if (!sameVersion(now, version)) {
      logger.warn({ file }, 'File changed while its message was processed; left in place, so a later poll reads it as it is now');
      return;
    }
    await postProcess();
  } catch (err) {
    await ledger.add(quarantineKey(name, version));
    logger.error({ ...errorInfo(err), file }, 'Post-action failed after successful dispatch; quarantining file');
  }
}

/**
 * The file that is deleted or moved is the one that was read: as long as its size and time
 * say so, a file that changed is read again instead. Errors from `version` before the
 * dispatch, `read` and `dispatcher` propagate.
 */
export async function dispatchQuarantined(job: QuarantinedFile): Promise<void> {
  const { ledger, logger, name, file, postProcess } = job;
  const taken = await readWhole(job);
  if (taken === null || (!taken.gone && job.stopped?.() === true)) return;

  const result = await job.dispatcher(taken.raw);
  if (!result.ok) {
    // Not taken by the pipeline at all: the file is there for the next poll, unless it is gone.
    if (taken.gone) logger.error({ ...errorInfo(result.error), file }, 'File was gone once it was read, and the pipeline did not take it: its content is lost');
    return;
  }

  const failure = dispatchFailure(result);
  if (failure !== null) {
    // Recorded with an error. Do not delete or move the file (that would report
    // success), and do not read it again (that would process it twice).
    await ledger.add(quarantineKey(name, taken.version));
    logger.error(
      { ...errorInfo(failure), file },
      'Pipeline recorded an error for this file; file kept in place and quarantined so it is not read again',
    );
    return;
  }
  if (postProcess !== null) await settle(job, postProcess, taken.version);
}
