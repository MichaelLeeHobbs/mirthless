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

  /** A copy to count down. */
  remaining(): Map<string, number> {
    return new Map(this.counts);
  }

  /** How many of them are among these rows. */
  countIn(rows: readonly Row[]): ReadonlyMap<string, number> {
    const found = new Map<string, number>();
    const missing = this.remaining();
    for (const row of rows) {
      if (missing.size === 0) break;
      const key = rowKey(JSON.stringify(row));
      const left = missing.get(key);
      if (left === undefined) continue;
      found.set(key, (found.get(key) ?? 0) + 1);
      if (left > 1) missing.set(key, left - 1);
      else missing.delete(key);
    }
    return found;
  }

  hasMoreThan(found: ReadonlyMap<string, number>): boolean {
    return [...this.counts].some(([key, count]) => count > (found.get(key) ?? 0));
  }

  /** The others are gone: marked or changed elsewhere. Should one come back, it is new. */
  keepOnly(found: ReadonlyMap<string, number>): void {
    for (const key of this.counts.keys()) {
      const count = found.get(key);
      if (count === undefined) this.counts.delete(key);
      else this.counts.set(key, count);
    }
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
