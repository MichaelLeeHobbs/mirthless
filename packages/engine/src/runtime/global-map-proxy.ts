// ===========================================
// Global Map Proxy
// ===========================================
// In-memory cache of the global map with dirty tracking
// and debounced flush to database via a callback.

// ----- Types -----

/** Callback to persist a single key-value pair to the database. */
export type FlushCallback = (key: string, value: string) => Promise<void>;

// ----- Implementation -----

/** In-memory proxy for the global map with dirty-tracking and periodic flush. */
export class GlobalMapProxy {
  private readonly store = new Map<string, unknown>();
  private readonly dirty = new Set<string>();
  private readonly flushCb: FlushCallback;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;

  constructor(flushCb: FlushCallback, flushIntervalMs?: number) {
    this.flushCb = flushCb;
    this.flushIntervalMs = flushIntervalMs ?? 5_000;
  }

  /** Initialize from a snapshot of key-value pairs. */
  load(entries: ReadonlyArray<{ readonly key: string; readonly value: string | null }>): void {
    for (const entry of entries) {
      this.store.set(entry.key, entry.value);
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

  /** Apply updates from sandbox execution. Marks changed keys as dirty. */
  applyUpdates(updates: Readonly<Record<string, unknown>>): void {
    for (const [key, value] of Object.entries(updates)) {
      const current = this.store.get(key);
      if (current !== value) {
        this.store.set(key, value);
        this.dirty.add(key);
      }
    }
  }

  /** Flush all dirty keys to the database. */
  async flush(): Promise<void> {
    if (this.dirty.size === 0) return;

    const keysToFlush = [...this.dirty];
    this.dirty.clear();

    const promises = keysToFlush.map((key) => {
      const value = this.store.get(key);
      const stringValue = value === null || value === undefined ? '' : String(value);
      return this.flushCb(key, stringValue);
    });

    await Promise.all(promises);
  }

  /** Stop the flush timer and flush any remaining dirty keys. */
  async dispose(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
