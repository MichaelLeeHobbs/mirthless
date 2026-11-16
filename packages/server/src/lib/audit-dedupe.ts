// ===========================================
// Audit Dedupe
// ===========================================
// Keeps the same caller's repeated reads of the same thing from writing an
// audit row each time (D-312, D-317): a 15-minute LRU of up to 100,000 keys.
// A key is the caller, route, channel and either the message id or the
// list's filters with its page, held as a SHA-256 so a long search term does
// not grow it. A repeated list writes again at once when it lists a message id
// not recorded yet, naming only those ids, so no listed message goes
// unrecorded. It runs after the guard, never caches a response, and is never
// used for exports, attachment downloads or backups.

import { createHash } from 'node:crypto';

/** How long a recorded read is not recorded again. */
export const AUDIT_DEDUPE_TTL_MS = 15 * 60_000;
const MAX_KEYS = 100_000;
/** The most ids held across every key: about 100 MB at the longest id. */
const MAX_TOTAL_IDS = 1_000_000;
/** How often remember() also drops expired keys. */
const SWEEP_EVERY = 1_000;

type Id = string | number;

interface Entry {
  readonly firstAt: number;
  readonly ids: Set<Id>;
}

export interface AuditDedupeLimits {
  readonly maxKeys?: number;
  readonly maxTotalIds?: number;
}

const digest = (key: string): string => createHash('sha256').update(key).digest('hex');

export class AuditDedupe {
  private readonly entries = new Map<string, Entry>();
  private readonly maxKeys: number;
  private readonly maxTotalIds: number;
  private totalIds = 0;
  private sinceSweep = 0;

  constructor(limits: AuditDedupeLimits = {}) {
    this.maxKeys = limits.maxKeys ?? MAX_KEYS;
    this.maxTotalIds = limits.maxTotalIds ?? MAX_TOTAL_IDS;
  }

  /** How many keys are held. */
  get size(): number {
    return this.entries.size;
  }

  /** The length of one held key. */
  get keyBytes(): number {
    return this.entries.keys().next().value?.length ?? 0;
  }

  /**
   * The ids to record for this read, or null when nothing needs recording. A
   * key not seen in 15 minutes records every id (an empty list records once);
   * a repeat records only ids not recorded under it yet.
   */
  idsToRecord(key: string, ids: readonly Id[], now: number): readonly Id[] | null {
    const k = digest(key);
    const entry = this.entries.get(k);
    if (!entry || now - entry.firstAt >= AUDIT_DEDUPE_TTL_MS) return ids;
    // Least recently used goes first: move the key to the end.
    this.entries.delete(k);
    this.entries.set(k, entry);
    const fresh = ids.filter((id) => !entry.ids.has(id));
    return fresh.length > 0 ? fresh : null;
  }

  /** Note that `ids` were recorded under `key` at `now`. Pass only ids that were written. */
  remember(key: string, ids: readonly Id[], now: number): void {
    const k = digest(key);
    const entry = this.entries.get(k);
    if (entry && now - entry.firstAt < AUDIT_DEDUPE_TTL_MS) {
      for (const id of ids) {
        if (!entry.ids.has(id)) { entry.ids.add(id); this.totalIds += 1; }
      }
    } else {
      this.drop(k);
      this.entries.set(k, { firstAt: now, ids: new Set(ids) });
      this.totalIds += new Set(ids).size;
    }
    this.sinceSweep += 1;
    if (this.sinceSweep >= SWEEP_EVERY) this.sweep(now);
    this.evict(k);
  }

  private drop(k: string): void {
    const entry = this.entries.get(k);
    if (!entry) return;
    this.totalIds -= entry.ids.size;
    this.entries.delete(k);
  }

  private sweep(now: number): void {
    this.sinceSweep = 0;
    for (const [k, e] of this.entries) if (now - e.firstAt >= AUDIT_DEDUPE_TTL_MS) this.drop(k);
  }

  /** Drop least recently used keys, never `keep`, until both caps hold. */
  private evict(keep: string): void {
    for (const k of this.entries.keys()) {
      if (this.entries.size <= this.maxKeys && this.totalIds <= this.maxTotalIds) return;
      if (k !== keep) this.drop(k);
    }
  }
}
