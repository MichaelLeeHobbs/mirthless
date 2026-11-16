// ===========================================
// Audit Dedupe Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { AuditDedupe, AUDIT_DEDUPE_TTL_MS, AUDIT_LIST_REFRESH_MS } from '../audit-dedupe.js';

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
  it('records a repeated page only for ids it has not recorded, at most once a minute', () => {
    const d = new AuditDedupe();
    d.remember('u1|list|c1|page1', [1, 2, 3], T0);

    // Within the minute: nothing, even with a new id.
    expect(d.idsToRecord('u1|list|c1|page1', [4, 1, 2], T0 + 30_000)).toBeNull();
    // After it: only the new id.
    expect(d.idsToRecord('u1|list|c1|page1', [4, 1, 2], T0 + AUDIT_LIST_REFRESH_MS)).toEqual([4]);
    d.remember('u1|list|c1|page1', [4], T0 + AUDIT_LIST_REFRESH_MS);
    // Nothing new: nothing to record.
    expect(d.idsToRecord('u1|list|c1|page1', [4, 1], T0 + 3 * AUDIT_LIST_REFRESH_MS)).toBeNull();
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
  it('forgets the least recently used key past its cap', () => {
    const d = new AuditDedupe(2);
    d.remember('a', [1], T0);
    d.remember('b', [1], T0);
    // Touch a, so b is the oldest.
    expect(d.idsToRecord('a', [1], T0 + 1)).toBeNull();
    d.remember('c', [1], T0 + 2);

    expect(d.size).toBe(2);
    expect(d.idsToRecord('b', [1], T0 + 3)).toEqual([1]);
    expect(d.idsToRecord('a', [1], T0 + 3)).toBeNull();
  });

  it('holds at most 1,000 ids per key; an id past that is recorded again, never dropped', () => {
    const d = new AuditDedupe();
    const many = Array.from({ length: 1500 }, (_, i) => i);
    d.remember('u1|list|c1|big', many, T0);
    expect(d.idsToRecord('u1|list|c1|big', [0], T0 + AUDIT_LIST_REFRESH_MS)).toBeNull();
    expect(d.idsToRecord('u1|list|c1|big', [1499], T0 + AUDIT_LIST_REFRESH_MS)).toEqual([1499]);
  });
});
