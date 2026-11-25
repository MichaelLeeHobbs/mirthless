// At most `max` attempts per key and window fail, and attempts that succeed do
// not count, however many come at once (D-363). An attempt's outcome is known
// only when it ends, so the failures and the attempts under way are never more
// than `max` together: the rest wait for a place, and are refused once `max`
// have failed.

export interface FailureLimitOptions {
  readonly max: number;
  readonly windowMs: number;
  readonly maxWaiting: number;
  readonly maxWaitMs: number;
  /** An attempt not settled by then counts as failed unless it succeeds later, so none holds a place for good. */
  readonly maxUnderWayMs: number;
}

export type Refusal =
  | { readonly admitted: false; readonly why: 'FAILURES'; readonly retryAfterMs: number }
  | { readonly admitted: false; readonly why: 'BUSY' | 'GONE' };

export type Admission =
  /** `settle` takes the outcome, once. */
  | { readonly admitted: true; readonly settle: (succeeded: boolean) => void }
  | Refusal;

interface Waiter {
  readonly gone: AbortSignal;
  readonly answer: (admission: Admission) => void;
}

interface Window {
  readonly endsAt: number;
}

interface Entry {
  failures: number;
  underWay: number;
  /** From the first failure on. */
  window: Window | null;
  readonly waiting: Waiter[];
}

export class FailureLimit {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: FailureLimitOptions) {}

  /** Aborting `gone` takes an attempt that waits out, and fails one that is under way. */
  async admit(key: string, gone: AbortSignal): Promise<Admission> {
    if (gone.aborted) return { admitted: false, why: 'GONE' };
    const entry = this.entries.get(key) ?? { failures: 0, underWay: 0, window: null, waiting: [] };
    if (entry.failures >= this.options.max) return this.refused(entry);
    if (this.hasPlace(entry)) {
      this.entries.set(key, entry);
      return this.start(key, entry, gone);
    }
    if (entry.waiting.length >= this.options.maxWaiting) return { admitted: false, why: 'BUSY' };
    return this.wait(entry, gone);
  }

  private hasPlace(entry: Entry): boolean {
    return entry.failures + entry.underWay < this.options.max;
  }

  private refused(entry: Entry): Refusal {
    return { admitted: false, why: 'FAILURES', retryAfterMs: Math.max(0, (entry.window?.endsAt ?? 0) - Date.now()) };
  }

  private wait(entry: Entry, gone: AbortSignal): Promise<Admission> {
    return new Promise((resolve) => {
      const answer = (admission: Admission): void => {
        clearTimeout(timer);
        gone.removeEventListener('abort', leave);
        resolve(admission);
      };
      const waiter: Waiter = { gone, answer };
      const drop = (why: 'BUSY' | 'GONE'): void => {
        entry.waiting.splice(entry.waiting.indexOf(waiter), 1);
        answer({ admitted: false, why });
      };
      const leave = (): void => { drop('GONE'); };
      const timer = setTimeout(() => { drop('BUSY'); }, this.options.maxWaitMs);
      gone.addEventListener('abort', leave);
      entry.waiting.push(waiter);
    });
  }

  private start(key: string, entry: Entry, gone: AbortSignal): Admission {
    entry.underWay += 1;
    let settled = false;
    let timedOutIn: Window | null = null;
    const end = (succeeded: boolean): void => {
      settled = true;
      clearTimeout(timer);
      gone.removeEventListener('abort', fail);
      entry.underWay -= 1;
      if (!succeeded) this.countFailure(key, entry);
      this.advance(key, entry);
    };
    const settle = (succeeded: boolean): void => {
      if (!settled) {
        end(succeeded);
        return;
      }
      // Past its window the entry may no longer be the key's: leave the one that is alone.
      const takesBack = succeeded && timedOutIn !== null && entry.window === timedOutIn;
      timedOutIn = null;
      if (!takesBack) return;
      entry.failures -= 1;
      this.advance(key, entry);
    };
    const fail = (): void => { end(false); };
    const timer = setTimeout(() => {
      end(false);
      timedOutIn = entry.window;
    }, this.options.maxUnderWayMs).unref();
    gone.addEventListener('abort', fail);
    return { admitted: true, settle };
  }

  private countFailure(key: string, entry: Entry): void {
    entry.failures += 1;
    if (entry.window !== null) return;
    entry.window = { endsAt: Date.now() + this.options.windowMs };
    setTimeout(() => {
      entry.window = null;
      entry.failures = 0;
      this.advance(key, entry);
    }, this.options.windowMs).unref();
  }

  private advance(key: string, entry: Entry): void {
    const refuse = entry.failures >= this.options.max;
    while (entry.waiting.length > 0 && (refuse || this.hasPlace(entry))) {
      const next = entry.waiting.shift();
      next?.answer(refuse ? this.refused(entry) : this.start(key, entry, next.gone));
    }
    if (entry.window === null && entry.underWay === 0) this.entries.delete(key);
  }
}
