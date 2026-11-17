// ===========================================
// API key daily row ceiling
// ===========================================
// A key may read at most a set number of rows from fail-closed reads (message
// searches, details, attachments, exports, sends) in a UTC day (D-313, RBAC
// plan section 7). The count lives in memory and is rebuilt per key and day
// from the audit log, where every such read by a key records its rows, so a
// restart neither resets it nor loses it. A leaked key with messages:read can
// then take at most a day's ceiling.
//
// At 80% of the ceiling the key's owner is warned once a day (#301): the
// caller claims the warning, writes it, and releases the claim if the write
// failed, so the next read tries again. Whether today's warning was already
// written is read back with the count, so a restart does not warn twice.
//
// One server process holds the count: a second process would rebuild its own
// from the audit log once a day and then count apart (the plan runs one).

/** The rows a key may read in a day, unless API_KEY_DAILY_ROWS sets another. */
export const DEFAULT_KEY_DAILY_ROWS = 5000;

/** The share of the ceiling at which a key's day is warned about. */
export const KEY_ROWS_WARN_FRACTION = 0.8;

export interface KeyRowCeilingOptions {
  readonly limit: number;
  /** The rows the audit log already holds for this principal since `since`. */
  readonly seed: (principalId: string, since: Date) => Promise<number>;
  /** Whether today's 80% warning for this principal was already written since `since`. */
  readonly seedWarned?: (principalId: string, since: Date) => Promise<boolean>;
  readonly now?: () => Date;
}

/** A warning that is due: its day, the day's count and the ceiling it is measured against. */
export interface RowWarning {
  readonly day: string;
  readonly used: number;
  readonly limit: number;
}

interface Day {
  readonly day: string;
  used: number;
  refusalNoted: boolean;
  warned: boolean;
}

/** Rows counted for a read, kept so they go back to the day they were taken from. */
export interface RowTicket {
  readonly principalId: string;
  readonly day: string;
  readonly rows: number;
}

/** The UTC day of `at`, as YYYY-MM-DD. */
function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export class KeyRowCeiling {
  private readonly days = new Map<string, Day>();
  private readonly seeding = new Map<string, Promise<Day>>();
  private readonly now: () => Date;

  constructor(private readonly options: KeyRowCeilingOptions) {
    this.now = options.now ?? ((): Date => new Date());
  }

  get limit(): number {
    return this.options.limit;
  }

  /** Today's count for `principalId`, read from the audit log the first time each day. */
  private async today(principalId: string): Promise<Day> {
    const day = dayOf(this.now());
    const current = this.days.get(principalId);
    if (current?.day === day) return current;
    const key = `${principalId}|${day}`;
    let pending = this.seeding.get(key);
    if (pending === undefined) {
      const since = new Date(`${day}T00:00:00Z`);
      // The warning is advice: when whether it was sent cannot be read, it may be sent again.
      const warned = (this.options.seedWarned?.(principalId, since) ?? Promise.resolve(false)).catch(() => false);
      pending = Promise.all([this.options.seed(principalId, since), warned])
        .then(([used, warned]) => {
          const entry: Day = { day, used, refusalNoted: false, warned };
          // A slow read for an earlier day never replaces a later day's count.
          const stored = this.days.get(principalId);
          if (stored === undefined || stored.day < day) this.days.set(principalId, entry);
          return stored !== undefined && stored.day === day ? stored : entry;
        })
        .finally(() => { this.seeding.delete(key); });
      this.seeding.set(key, pending);
    }
    return pending;
  }

  /**
   * Count `rows` against today's ceiling and return the ticket to give them
   * back with, or null and count nothing when they would pass it. Throws when
   * today's count cannot be read, so the read is refused rather than let
   * through uncounted.
   */
  async take(principalId: string, rows: number): Promise<RowTicket | null> {
    const entry = await this.today(principalId);
    if (entry.used + rows > this.options.limit) return null;
    entry.used += rows;
    return { principalId, day: entry.day, rows };
  }

  /** Give back the rows of a read that was then not sent, to the day they were counted on. */
  giveBack(ticket: RowTicket): void {
    const entry = this.days.get(ticket.principalId);
    if (entry?.day === ticket.day) entry.used = Math.max(0, entry.used - ticket.rows);
  }

  /**
   * True the first time it is asked each day for `principalId`: the refusal
   * should be recorded. Call `forgetRefusal` when that record could not be
   * written, so the next refusal tries again.
   */
  firstRefusalToday(principalId: string): boolean {
    const entry = this.days.get(principalId);
    if (!entry || entry.day !== dayOf(this.now()) || entry.refusalNoted) return false;
    entry.refusalNoted = true;
    return true;
  }

  forgetRefusal(principalId: string): void {
    const entry = this.days.get(principalId);
    if (entry) entry.refusalNoted = false;
  }

  /**
   * The warning to write when today's count has reached 80% of the ceiling and
   * none was claimed yet today, or null. Claiming marks it sent; call
   * `releaseWarning` when the write failed.
   */
  claimWarning(principalId: string): RowWarning | null {
    const entry = this.days.get(principalId);
    if (!entry || entry.day !== dayOf(this.now()) || entry.warned) return null;
    if (entry.used < this.options.limit * KEY_ROWS_WARN_FRACTION) return null;
    entry.warned = true;
    return { day: entry.day, used: entry.used, limit: this.options.limit };
  }

  /** Undo a claim whose write failed, unless the day it was claimed on has passed. */
  releaseWarning(principalId: string, warning: RowWarning): void {
    const entry = this.days.get(principalId);
    if (entry?.day === warning.day) entry.warned = false;
  }
}
