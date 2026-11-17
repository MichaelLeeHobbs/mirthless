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
// One server process holds the count: a second process would rebuild its own
// from the audit log once a day and then count apart (the plan runs one).

/** The rows a key may read in a day, unless API_KEY_DAILY_ROWS sets another. */
export const DEFAULT_KEY_DAILY_ROWS = 5000;

export interface KeyRowCeilingOptions {
  readonly limit: number;
  /** The rows the audit log already holds for this principal since `since`. */
  readonly seed: (principalId: string, since: Date) => Promise<number>;
  readonly now?: () => Date;
}

interface Day {
  readonly day: string;
  used: number;
  refusalNoted: boolean;
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
      pending = this.options.seed(principalId, new Date(`${day}T00:00:00Z`))
        .then((used) => {
          const entry: Day = { day, used, refusalNoted: false };
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
}
