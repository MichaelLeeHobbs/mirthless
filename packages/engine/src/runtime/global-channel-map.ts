// ===========================================
// Global Channel Map
// ===========================================
// Per-channel in-memory key-value store that persists
// across messages within a single deployment.
// Cleared when the channel is undeployed.

import { diffMap } from './map-diff.js';

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

  /**
   * Apply what a script changed. `before` is the snapshot the script was given
   * and `after` is the map it left; only keys that differ are written, so a
   * key another message changed in the meantime is kept.
   */
  applyChanges(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): void {
    const changes = diffMap(before, after);
    for (const [key, value] of changes.set) {
      this.store.set(key, value);
    }
    for (const key of changes.removed) {
      this.store.delete(key);
    }
  }
}
