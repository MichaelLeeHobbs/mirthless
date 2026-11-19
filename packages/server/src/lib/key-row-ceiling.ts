// An API key's daily row ceiling (D-313) and 80% warning (#301), per UTC day.
// Counts live in memory, rebuilt per key and day from the audit log, so a
// restart neither resets the count nor warns twice. One server process holds
// the count: a second would rebuild its own and then count apart.

/** API_KEY_DAILY_ROWS overrides it. */
export const DEFAULT_KEY_DAILY_ROWS = 5000;

export const KEY_ROWS_WARN_FRACTION = 0.8;

export interface KeyRowCeilingOptions {
  readonly limit: number;
  /** Rows the audit log holds for the principal since `since`. */
  readonly seed: (principalId: string, since: Date) => Promise<number>;
  /** Whether the 80% warning was already written since `since`. */
  readonly seedWarned?: (principalId: string, since: Date) => Promise<boolean>;
  readonly now?: () => Date;
}

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

/** Carries its day so giveBack returns rows to the day they were counted on. */
export interface RowTicket {
  readonly principalId: string;
  readonly day: string;
  readonly rows: number;
}

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
   * Null counts nothing. Throws when today's count cannot be read: refuse the
   * read rather than let it through uncounted.
   */
  async take(principalId: string, rows: number): Promise<RowTicket | null> {
    const entry = await this.today(principalId);
    if (entry.used + rows > this.options.limit) return null;
    entry.used += rows;
    return { principalId, day: entry.day, rows };
  }

  /** For a read that was counted and then not sent. */
  giveBack(ticket: RowTicket): void {
    const entry = this.days.get(ticket.principalId);
    if (entry?.day === ticket.day) entry.used = Math.max(0, entry.used - ticket.rows);
  }

  /** True once a day per principal. Call `forgetRefusal` when the refusal record could not be written. */
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

  /** Claiming marks the warning sent; call `releaseWarning` when the write failed. */
  claimWarning(principalId: string): RowWarning | null {
    const entry = this.days.get(principalId);
    if (!entry || entry.day !== dayOf(this.now()) || entry.warned) return null;
    if (entry.used < this.options.limit * KEY_ROWS_WARN_FRACTION) return null;
    entry.warned = true;
    return { day: entry.day, used: entry.used, limit: this.options.limit };
  }

  releaseWarning(principalId: string, warning: RowWarning): void {
    const entry = this.days.get(principalId);
    if (entry?.day === warning.day) entry.warned = false;
  }
}
