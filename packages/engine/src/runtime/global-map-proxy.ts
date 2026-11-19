// The one in-memory copy of the global map, shared by every deployed channel.

import { GlobalChannelMap } from './global-channel-map.js';

export interface GlobalMapStore {
  /** `isJson` is false for plain text, true for any other value stored as JSON. */
  readonly save: (key: string, value: string, isJson: boolean) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
  /** The key stays pending and is retried on the next flush. */
  readonly onFlushError: (key: string, error: unknown) => void;
}

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

export class GlobalMapProxy {
  private readonly map = new GlobalChannelMap();
  private readonly dirty = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly persistence: GlobalMapStore;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;

  constructor(persistence: GlobalMapStore, flushIntervalMs?: number) {
    this.persistence = persistence;
    this.flushIntervalMs = flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  load(entries: ReadonlyArray<GlobalMapRow>): void {
    for (const entry of entries) {
      this.map.put(entry.key, fromRow(entry));
    }
  }

  start(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  toRecord(): Record<string, unknown> {
    return this.map.toRecord();
  }

  applyChanges(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): void {
    for (const key of this.map.applyChanges(before, after)) {
      this.dirty.add(key);
    }
  }

  // An API edit is already in the database, but a script save of the same key on
  // another connection can commit after it, even one whose promise resolved before
  // the API told the proxy. So an API edit always marks the key dirty and the next
  // flush writes the API's value last (#92). The extra write is idempotent.

  /** Take an entry that the API already persisted. */
  set(row: GlobalMapRow): void {
    this.map.put(row.key, fromRow(row));
    this.dirty.add(row.key);
  }

  /** Drop an entry the API already removed from the database. */
  delete(key: string): void {
    this.map.remove(key);
    this.dirty.add(key);
  }

  /** Drop every entry; the API already cleared the database. */
  clear(): void {
    for (const key of Object.keys(this.map.toRecord())) this.dirty.add(key);
    this.map.clear();
  }

  /** Never rejects: failures are reported and retried next time. */
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
    if (!this.map.containsKey(key)) {
      await this.persistence.remove(key);
      return;
    }
    const value = this.map.get(key);
    if (typeof value === 'string') {
      await this.persistence.save(key, value, false);
    } else {
      await this.persistence.save(key, JSON.stringify(value) ?? 'null', true);
    }
  }
}
