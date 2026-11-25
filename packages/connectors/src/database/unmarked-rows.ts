import { createHash } from 'node:crypto';

export type Row = Readonly<Record<string, unknown>>;

/** A row that a poll took. */
export interface TakenRow {
  readonly row: Row;
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

  keys(): ReadonlySet<string> {
    return new Set(this.counts.keys());
  }

  /** A copy to count down. */
  remaining(): Map<string, number> {
    return new Map(this.counts);
  }

  /** For rows that are gone: marked or changed elsewhere. Should one come back, it is new. */
  forget(keys: ReadonlySet<string>): void {
    for (const key of keys) this.counts.delete(key);
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

/** Which of the keys none of the rows has. */
export function keysNotIn(rows: readonly Row[], keys: ReadonlySet<string>): ReadonlySet<string> {
  const missing = new Set(keys);
  for (const row of rows) {
    if (missing.size === 0) break;
    missing.delete(rowKey(JSON.stringify(row)));
  }
  return missing;
}
