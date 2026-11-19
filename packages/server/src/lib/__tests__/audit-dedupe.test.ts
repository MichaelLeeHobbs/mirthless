import { describe, it, expect } from 'vitest';
import { AuditDedupe, AUDIT_DEDUPE_TTL_MS } from '../audit-dedupe.js';

const T0 = 1_000_000;

describe('AuditDedupe, one record (message detail)', () => {
  it('records the first read, skips repeats for 15 minutes, then records again', () => {
    const d = new AuditDedupe();
    expect(d.idsToRecord('u1|detail|c1|7', [7], T0)).toEqual([7]);
    d.remember('u1|detail|c1|7', [7], T0);

    expect(d.idsToRecord('u1|detail|c1|7', [7], T0 + AUDIT_DEDUPE_TTL_MS - 1)).toBeNull();
    expect(d.idsToRecord('u1|detail|c1|7', [7], T0 + AUDIT_DEDUPE_TTL_MS)).toEqual([7]);
  });

  it('keeps callers, routes and messages apart', () => {
    const d = new AuditDedupe();
    d.remember('u1|detail|c1|7', [7], T0);
    expect(d.idsToRecord('u2|detail|c1|7', [7], T0)).toEqual([7]);
    expect(d.idsToRecord('u1|detail|c1|8', [8], T0)).toEqual([8]);
  });
});

describe('AuditDedupe, a list', () => {
  it('records a repeated page again at once when it lists an id not yet recorded, and only that id', () => {
    const d = new AuditDedupe();
    d.remember('u1|list|c1|page1', [1, 2, 3], T0);

    expect(d.idsToRecord('u1|list|c1|page1', [4, 1, 2], T0 + 1_000)).toEqual([4]);
    d.remember('u1|list|c1|page1', [4], T0 + 1_000);
    expect(d.idsToRecord('u1|list|c1|page1', [4, 1], T0 + 2_000)).toBeNull();
  });

  it('records the whole page again once the 15 minutes have passed', () => {
    const d = new AuditDedupe();
    d.remember('u1|list|c1|page1', [1, 2], T0);
    expect(d.idsToRecord('u1|list|c1|page1', [1, 2], T0 + AUDIT_DEDUPE_TTL_MS)).toEqual([1, 2]);
  });

  it('records an empty page once, then dedupes it like any other', () => {
    const d = new AuditDedupe();
    expect(d.idsToRecord('u1|list|c1|none', [], T0)).toEqual([]);
    d.remember('u1|list|c1|none', [], T0);
    expect(d.idsToRecord('u1|list|c1|none', [], T0 + 1)).toBeNull();
  });
});

describe('AuditDedupe, bounds', () => {
  it('forgets the least recently used key past its key cap', () => {
    const d = new AuditDedupe({ maxKeys: 2 });
    d.remember('a', [1], T0);
    d.remember('b', [1], T0);
    // Touch a, so b is the oldest.
    expect(d.idsToRecord('a', [1], T0 + 1)).toBeNull();
    d.remember('c', [1], T0 + 2);

    expect(d.size).toBe(2);
    expect(d.idsToRecord('b', [1], T0 + 3)).toEqual([1]);
    expect(d.idsToRecord('a', [1], T0 + 3)).toBeNull();
  });

  it('forgets the oldest keys once the ids held across all keys pass their cap', () => {
    const d = new AuditDedupe({ maxTotalIds: 5 });
    d.remember('a', [1, 2, 3], T0);
    d.remember('b', [1, 2, 3], T0 + 1);

    expect(d.size).toBe(1);
    expect(d.idsToRecord('a', [1], T0 + 2)).toEqual([1]);
  });

  it('holds a key as a fixed-length hash, so a long search term does not grow it', () => {
    const d = new AuditDedupe();
    d.remember(`u1|search|c1|${'x'.repeat(5_000)}`, [1], T0);
    expect(d.keyBytes).toBe(64);
  });

  it('drops expired keys as it goes, without waiting for the cap', () => {
    const d = new AuditDedupe();
    d.remember('old', [1], T0);
    for (let i = 0; i < 1_000; i += 1) d.remember(`k${String(i)}`, [i], T0 + AUDIT_DEDUPE_TTL_MS + i);
    expect(d.idsToRecord('old', [1], T0 + AUDIT_DEDUPE_TTL_MS + 2_000)).toEqual([1]);
    expect(d.size).toBe(1_000);
  });
});
