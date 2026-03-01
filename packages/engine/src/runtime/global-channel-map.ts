// ===========================================
// Global Channel Map
// ===========================================
// Per-channel in-memory key-value store that persists
// across messages within a single deployment.
// Cleared when the channel is undeployed.

/** Per-channel map persisting across messages within a deployment. */
export class GlobalChannelMap {
  private readonly store = new Map<string, unknown>();

  /** Get a value by key. Returns undefined if not found. */
  get(key: string): unknown {
    return this.store.get(key);
  }

  /** Set a key-value pair. */
  put(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /** Check if a key exists. */
  containsKey(key: string): boolean {
    return this.store.has(key);
  }

  /** Remove a key. Returns true if key existed. */
  remove(key: string): boolean {
    return this.store.delete(key);
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Snapshot current state as a plain record for sandbox injection. */
  toRecord(): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [key, value] of this.store) {
      record[key] = value;
    }
    return record;
  }

  /** Apply updates from sandbox execution back to the store. */
  applyUpdates(updates: Readonly<Record<string, unknown>>): void {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        this.store.delete(key);
      } else {
        this.store.set(key, value);
      }
    }
  }
}
