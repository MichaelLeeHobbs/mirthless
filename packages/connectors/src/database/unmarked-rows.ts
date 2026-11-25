import { createHash } from 'node:crypto';

/** A row that a poll took. */
export interface TakenRow {
  readonly row: Readonly<Record<string, unknown>>;
  readonly key: string;
  /** The pipeline has the message: from this poll, or from an earlier one that could not mark the row. */
  readonly recorded: boolean;
  /** From an earlier poll. */
  readonly known: boolean;
  marked: boolean;
}

/** Rows are told apart by their whole content, so one that changed is a new row. A hash, because the content is PHI. */
export function rowKey(content: string): string {
  return createHash('sha256').update(content).digest('base64');
}

/**
 * The rows whose message is in the pipeline and which could not be marked: read again, they are
 * marked and not dispatched. Counted, because a query may return several rows that read the same.
 * Not kept over a restart.
 */
export class UnmarkedRows {
  private readonly counts = new Map<string, number>();

  /**
   * Keeps what the poll's rows still hold, and gives a copy to count down. A row that the query
   * no longer returns was marked or changed elsewhere; should it come back, it is new.
   */
  returned(keys: Iterable<string>): Map<string, number> {
    const now = new Set(keys);
    for (const key of this.counts.keys()) {
      if (!now.has(key)) this.counts.delete(key);
    }
    return new Map(this.counts);
  }

  settle(taken: readonly TakenRow[]): void {
    for (const { key, recorded, known, marked } of taken) {
      if (known && marked) this.add(key, -1);
      if (!known && recorded && !marked) this.add(key, 1);
    }
  }

  private add(key: string, change: number): void {
    const count = (this.counts.get(key) ?? 0) + change;
    if (count > 0) this.counts.set(key, count);
    else this.counts.delete(key);
  }
}
