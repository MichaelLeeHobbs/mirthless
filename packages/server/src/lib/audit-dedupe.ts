// ===========================================
// Audit Dedupe
// ===========================================
// Keeps repeated reads of the same thing by the same caller from writing an
// audit row each time (D-312): a 15-minute LRU of up to 100,000 keys. A key is
// the caller, route, channel and either the message id or the list's filters
// with its page. It runs after the guard, never caches a response, and is
// never used for exports, attachment downloads or backups. A repeated list
// still records message ids it has not recorded, at most once a minute.

/** How long a recorded read is not recorded again. */
export const AUDIT_DEDUPE_TTL_MS = 15 * 60_000;
/** How often a repeated list may record ids it has not recorded yet. */
export const AUDIT_LIST_REFRESH_MS = 60_000;
const MAX_KEYS = 100_000;
const MAX_IDS_PER_KEY = 1_000;

type Id = string | number;

interface Entry {
  readonly firstAt: number;
  lastRecordAt: number;
  readonly ids: Set<Id>;
}

export class AuditDedupe {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxKeys = MAX_KEYS) {}

  /** How many keys are held. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * The ids to record for this read, or null when nothing needs recording.
   * A key not seen in 15 minutes records every id (an empty list records once).
   */
  idsToRecord(key: string, ids: readonly Id[], now: number): readonly Id[] | null {
    const entry = this.entries.get(key);
    if (!entry || now - entry.firstAt >= AUDIT_DEDUPE_TTL_MS) return ids;
    // Least recently used goes first: move the key to the end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (now - entry.lastRecordAt < AUDIT_LIST_REFRESH_MS) return null;
    const fresh = ids.filter((id) => !entry.ids.has(id));
    return fresh.length > 0 ? fresh : null;
  }

  /** Note that `ids` were recorded under `key` at `now`. */
  remember(key: string, ids: readonly Id[], now: number): void {
    const entry = this.entries.get(key);
    if (entry && now - entry.firstAt < AUDIT_DEDUPE_TTL_MS) {
      entry.lastRecordAt = now;
      for (const id of ids) if (entry.ids.size < MAX_IDS_PER_KEY) entry.ids.add(id);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, { firstAt: now, lastRecordAt: now, ids: new Set(ids.slice(0, MAX_IDS_PER_KEY)) });
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
