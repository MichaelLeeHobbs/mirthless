// Skips repeat audit rows for a caller's repeated reads (D-312, D-317). Keys are
// hashed so a long search term does not grow them. Run it after the guard; never
// use it for exports, attachment downloads or backups.

import { createHash } from 'node:crypto';

export const AUDIT_DEDUPE_TTL_MS = 15 * 60_000;
const MAX_KEYS = 100_000;
/** About 100 MB at the longest id. */
const MAX_TOTAL_IDS = 1_000_000;
/** Counted in remember() calls. */
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

  get size(): number {
    return this.entries.size;
  }

  get keyBytes(): number {
    return this.entries.keys().next().value?.length ?? 0;
  }

  /** Null means skip; an empty array still means record once. */
  idsToRecord(key: string, ids: readonly Id[], now: number): readonly Id[] | null {
    const k = digest(key);
    const entry = this.entries.get(k);
    if (!entry || now - entry.firstAt >= AUDIT_DEDUPE_TTL_MS) return ids;
    // Re-insert to mark the key most recently used; eviction walks from the front.
    this.entries.delete(k);
    this.entries.set(k, entry);
    const fresh = ids.filter((id) => !entry.ids.has(id));
    return fresh.length > 0 ? fresh : null;
  }

  /** Pass only ids that were written. */
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

  private evict(keep: string): void {
    for (const k of this.entries.keys()) {
      if (this.entries.size <= this.maxKeys && this.totalIds <= this.maxTotalIds) return;
      if (k !== keep) this.drop(k);
    }
  }
}
