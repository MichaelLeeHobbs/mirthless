/**
 * An outage is over once the source has worked this long, which takes two reports: one that works now and
 * then would alert each time.
 */
export const OUTAGE_OVER_AFTER_MS = 60_000;

/** The first alert of an outage may be held back by one sent shortly before it. */
export const OUTAGE_REPEAT_MS = 3_600_000;

/** Which of the failures a source reports are due an alert, so that an outage is not one alert for each poll. */
export class SourceHealth {
  private reportedAt: number | null = null;
  private workingSince: number | null = null;
  private workedUntil = 0;

  /** Whether an alert is due. `failure` is null when the source worked. */
  report(failure: Error | null, now: number): boolean {
    if (failure === null) {
      this.workingSince ??= now;
      this.workedUntil = now;
      return false;
    }
    const over = this.workingSince !== null && this.workedUntil - this.workingSince >= OUTAGE_OVER_AFTER_MS;
    this.workingSince = null;
    if (this.reportedAt !== null && !over && now - this.reportedAt < OUTAGE_REPEAT_MS) return false;
    this.reportedAt = now;
    return true;
  }
}
