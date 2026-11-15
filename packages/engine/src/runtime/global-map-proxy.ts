// ===========================================
// Global Map Proxy
// ===========================================
// The one in-memory copy of the global map, shared by every deployed channel.
// Tracks which keys scripts changed and saves them to the database on a timer.

import { diffMap } from './map-diff.js';

// ----- Types -----

/** Where the global map is persisted. */
export interface GlobalMapStore {
  /** Save one entry. `isJson` is false for plain text, true for any other value stored as JSON. */
  readonly save: (key: string, value: string, isJson: boolean) => Promise<void>;
  /** Remove one entry. */
  readonly remove: (key: string) => Promise<void>;
  /** Called when a save or remove fails. The key stays pending and is retried on the next flush. */
  readonly onFlushError: (key: string, error: unknown) => void;
}

/** A persisted global map entry. */
export interface GlobalMapRow {
  readonly key: string;
  readonly value: string | null;
  readonly isJson: boolean;
}

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

function fromRow(row: GlobalMapRow): unknown {
  if (!row.isJson || row.value === null) return row.value;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return row.value;
  }
}

// ----- Implementation -----

/** In-memory global map with change tracking and periodic flush. */
export class GlobalMapProxy {
  private readonly store = new Map<string, unknown>();
  private readonly dirty = new Set<string>();
  /** The latest write of each key that has not settled yet. */
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly persistence: GlobalMapStore;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;

  constructor(persistence: GlobalMapStore, flushIntervalMs?: number) {
    this.persistence = persistence;
    this.flushIntervalMs = flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  /** Initialize from persisted entries. Plain text stays text; JSON entries get their type back. */
  load(entries: ReadonlyArray<GlobalMapRow>): void {
    for (const entry of entries) {
      this.store.set(entry.key, fromRow(entry));
    }
  }

  /** Start periodic flush timer. */
  start(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  /** Get a snapshot as a plain record for sandbox injection. */
  toRecord(): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [key, value] of this.store) {
      record[key] = value;
    }
    return record;
  }

  /**
   * Apply what a script changed. `before` is the snapshot the script was given
   * and `after` is the map it left; only keys that differ are written.
   */
  applyChanges(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): void {
    const changes = diffMap(before, after);
    for (const [key, value] of changes.set) {
      this.store.set(key, value);
      this.dirty.add(key);
    }
    for (const key of changes.removed) {
      this.store.delete(key);
      this.dirty.add(key);
    }
  }

  // An edit made through the API is already in the database, but a script save
  // of the same key on another connection can commit after it, even one whose
  // promise resolved before the API told the proxy. So an API edit always marks
  // the key dirty: the next flush writes the API's value last. The extra write
  // is idempotent.

  /** Take an entry that the API already persisted. */
  set(row: GlobalMapRow): void {
    this.store.set(row.key, fromRow(row));
    this.dirty.add(row.key);
  }

  /** Drop an entry the API already removed from the database. */
  delete(key: string): void {
    this.store.delete(key);
    this.dirty.add(key);
  }

  /** Drop every entry; the API already cleared the database. */
  clear(): void {
    for (const key of this.store.keys()) this.dirty.add(key);
    this.store.clear();
  }

  /** Save every changed key. Never rejects: failures are reported and retried next time. */
  async flush(): Promise<void> {
    if (this.dirty.size === 0) return;

    const keys = [...this.dirty];
    this.dirty.clear();

    const results = await Promise.allSettled(keys.map((key) => this.persistInOrder(key)));
    results.forEach((result, i) => {
      const key = keys[i];
      if (result.status === 'rejected' && key !== undefined) {
        this.dirty.add(key);
        this.persistence.onFlushError(key, result.reason);
      }
    });
  }

  /** Stop the flush timer and flush any remaining changes. */
  async dispose(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Persist a key after any earlier write of the same key has settled, so two
   * flushes can never land one key's values out of order. The value is read
   * when the write starts, not when it is queued.
   */
  private persistInOrder(key: string): Promise<void> {
    const previous = this.inFlight.get(key);
    const write = previous === undefined
      ? this.persistKey(key)
      : previous.then(() => this.persistKey(key), () => this.persistKey(key));
    this.inFlight.set(key, write);
    const settle = (): void => {
      if (this.inFlight.get(key) === write) this.inFlight.delete(key);
    };
    void write.then(settle, settle);
    return write;
  }

  private async persistKey(key: string): Promise<void> {
    if (!this.store.has(key)) {
      await this.persistence.remove(key);
      return;
    }
    const value = this.store.get(key);
    if (typeof value === 'string') {
      await this.persistence.save(key, value, false);
    } else {
      await this.persistence.save(key, JSON.stringify(value) ?? 'null', true);
    }
  }
}
