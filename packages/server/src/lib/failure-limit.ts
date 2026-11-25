// At most `max` attempts per key and window fail, and attempts that succeed do
// not count, however many come at once (D-358). An attempt's outcome is known
// only when it ends, so the failures and the attempts under way are never more
// than `max` together: the rest wait for a place, and are refused once `max`
// have failed.

export interface FailureLimitOptions {
  readonly max: number;
  readonly windowMs: number;
  readonly maxWaiting: number;
  readonly maxWaitMs: number;
}

export type Refusal =
  | { readonly admitted: false; readonly why: 'FAILURES'; readonly retryAfterMs: number }
  | { readonly admitted: false; readonly why: 'BUSY' | 'GONE' };

export type Admission =
  /** Call `settle` once the outcome is known, whatever it is: until then the attempt holds its place. Later calls do nothing. */
  | { readonly admitted: true; readonly settle: (succeeded: boolean) => void }
  | Refusal;

interface Entry {
  failures: number;
  underWay: number;
  windowEndsAt: number;
  readonly waiting: Array<(admission: Admission) => void>;
}

export class FailureLimit {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: FailureLimitOptions) {}

  /** `gone` gives up the place of an attempt that waits. */
  async admit(key: string, gone: AbortSignal): Promise<Admission> {
    if (gone.aborted) return { admitted: false, why: 'GONE' };
    const entry = this.entries.get(key) ?? { failures: 0, underWay: 0, windowEndsAt: 0, waiting: [] };
    if (entry.failures >= this.options.max) return this.refused(entry);
    if (this.hasPlace(entry)) {
      this.entries.set(key, entry);
      return this.start(key, entry);
    }
    if (entry.waiting.length >= this.options.maxWaiting) return { admitted: false, why: 'BUSY' };
    return this.wait(entry, gone);
  }

  /** Keys something is held for, for tests. */
  get size(): number {
    return this.entries.size;
  }

  private hasPlace(entry: Entry): boolean {
    return entry.failures + entry.underWay < this.options.max;
  }

  private refused(entry: Entry): Refusal {
    return { admitted: false, why: 'FAILURES', retryAfterMs: Math.max(0, entry.windowEndsAt - Date.now()) };
  }

  private wait(entry: Entry, gone: AbortSignal): Promise<Admission> {
    return new Promise((resolve) => {
      const give = (admission: Admission): void => {
        clearTimeout(timer);
        gone.removeEventListener('abort', leave);
        resolve(admission);
      };
      const drop = (why: 'BUSY' | 'GONE'): void => {
        entry.waiting.splice(entry.waiting.indexOf(give), 1);
        give({ admitted: false, why });
      };
      const leave = (): void => { drop('GONE'); };
      const timer = setTimeout(() => { drop('BUSY'); }, this.options.maxWaitMs);
      gone.addEventListener('abort', leave);
      entry.waiting.push(give);
    });
  }

  private start(key: string, entry: Entry): Admission {
    entry.underWay += 1;
    let settled = false;
    return {
      admitted: true,
      settle: (succeeded) => {
        if (settled) return;
        settled = true;
        entry.underWay -= 1;
        if (!succeeded) this.countFailure(key, entry);
        this.advance(key, entry);
      },
    };
  }

  private countFailure(key: string, entry: Entry): void {
    entry.failures += 1;
    if (entry.failures > 1) return;
    entry.windowEndsAt = Date.now() + this.options.windowMs;
    setTimeout(() => {
      entry.failures = 0;
      this.advance(key, entry);
    }, this.options.windowMs).unref();
  }

  private advance(key: string, entry: Entry): void {
    const refuse = entry.failures >= this.options.max;
    while (entry.waiting.length > 0 && (refuse || this.hasPlace(entry))) {
      entry.waiting.shift()?.(refuse ? this.refused(entry) : this.start(key, entry));
    }
    if (entry.failures === 0 && entry.underWay === 0) this.entries.delete(key);
  }
}
