import { diffMap } from './map-diff.js';

export class GlobalChannelMap {
  private readonly store = new Map<string, unknown>();

  get(key: string): unknown {
    return this.store.get(key);
  }

  put(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  containsKey(key: string): boolean {
    return this.store.has(key);
  }

  remove(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  toRecord(): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [key, value] of this.store) {
      record[key] = value;
    }
    return record;
  }

  /**
   * `before` is the snapshot the script was given; only keys that differ from it
   * are written, so a key another message changed in the meantime is kept.
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
