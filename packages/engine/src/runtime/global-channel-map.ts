// ===========================================
// Global Channel Map
// ===========================================
// In-memory key-value store for a script map that persists across messages.
// Each deployed channel has one for its channel map, cleared when the channel
// is undeployed. GlobalMapProxy keeps the server-wide global map in one too.

import { diffMap } from './map-diff.js';

/** In-memory script map persisting across messages (a channel's map, or the global map's entries). */
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
   *
   * @returns The keys written or removed, so a caller can track what changed.
   */
  applyChanges(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): ReadonlyArray<string> {
    const changes = diffMap(before, after);
    const changed: string[] = [];
    for (const [key, value] of changes.set) {
      this.store.set(key, value);
      changed.push(key);
    }
    for (const key of changes.removed) {
      this.store.delete(key);
      changed.push(key);
    }
    return changed;
  }
}
