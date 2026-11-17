import { describe, expect, it } from 'vitest';
import type { ApiKeyView } from '@galvanigraph/core-models';
import { draftProblem, keyScopeLabel, keysDueSoon, liveKeysIssuedBy, needsReason, replacementCountdown, toIssueInput, type KeyDraft } from '../api-keys.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const DAY = 86_400_000;

function key(over: Partial<ApiKeyView>): ApiKeyView {
  return {
    id: 'k', name: 'Feed', description: '', permissions: ['channels:read'], groupIds: null, status: 'active',
    expiresAt: '2027-01-01T00:00:00.000Z', reason: null, issuedBy: { id: 'u1', username: 'priya' },
    revokedAt: null, revokeReason: null, lastUsedAt: null, lastUsedIp: null, createdAt: '2026-11-01T00:00:00.000Z',
    replaceBy: null, previousSecretUntil: null, ...over,
  };
}

/** A datetime-local value for `ms` in this machine's zone. */
function local(ms: number): string {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

describe('replacementCountdown', () => {
  it('counts down days, then hours, for a key waiting on a leaver\'s replacement', () => {
    expect(replacementCountdown(key({ replaceBy: new Date(NOW + 3 * DAY - 1000).toISOString() }), NOW)).toBe('Disabled in 3 days unless replaced');
    expect(replacementCountdown(key({ replaceBy: new Date(NOW + 1 * DAY + 1000).toISOString() }), NOW)).toBe('Disabled in 2 days unless replaced');
    expect(replacementCountdown(key({ replaceBy: new Date(NOW + 5 * 3_600_000).toISOString() }), NOW)).toBe('Disabled in 5 hours unless replaced');
    expect(replacementCountdown(key({ replaceBy: new Date(NOW + 60_000).toISOString() }), NOW)).toBe('Disabled in 1 hour unless replaced');
    expect(replacementCountdown(key({ replaceBy: new Date(NOW - 1).toISOString() }), NOW)).toBe('Disabled: not replaced in time');
  });

  it('says nothing for a key with no deadline, or one already off', () => {
    expect(replacementCountdown(key({}), NOW)).toBeNull();
    expect(replacementCountdown(key({ replaceBy: new Date(NOW + DAY).toISOString(), status: 'disabled' }), NOW)).toBeNull();
  });
});

describe('keysDueSoon', () => {
  it('lists the active keys within two days of their deadline', () => {
    const soon = key({ id: 'soon', replaceBy: new Date(NOW + DAY).toISOString() });
    const later = key({ id: 'later', replaceBy: new Date(NOW + 4 * DAY).toISOString() });
    const off = key({ id: 'off', status: 'revoked', replaceBy: new Date(NOW + DAY).toISOString() });
    expect(keysDueSoon([soon, later, off, key({ id: 'none' })], NOW).map((k) => k.id)).toEqual(['soon']);
  });
});

describe('liveKeysIssuedBy', () => {
  it('lists the working keys a user issued: offboarding acts on no other', () => {
    const keys = [
      key({ id: 'a' }), key({ id: 'b', status: 'disabled' }), key({ id: 'c', status: 'revoked' }),
      key({ id: 'd', status: 'expired' }), key({ id: 'e', issuedBy: { id: 'u2', username: 'x' } }),
    ];
    expect(liveKeysIssuedBy(keys, 'u1').map((k) => k.id)).toEqual(['a']);
  });
});

describe('keyScopeLabel', () => {
  it('names every channel or the groups', () => {
    expect(keyScopeLabel(null, (id) => id)).toBe('All channels');
    expect(keyScopeLabel(['g1', 'g2'], (id) => ({ g1: 'Lab', g2: 'Radiology' })[id] ?? id)).toBe('Lab, Radiology');
  });
});

describe('the issue form', () => {
  const draft: KeyDraft = { name: ' Lab feed ', description: '', permissions: ['channels:read'], groupIds: ['g1'], expiresAt: local(NOW + 30 * DAY), reason: '' };

  it('needs a name, a permission, groups when scoped, and a future end', () => {
    expect(draftProblem(draft, NOW)).toBeNull();
    expect(draftProblem({ ...draft, name: ' ' }, NOW)).toMatch(/Name/);
    expect(draftProblem({ ...draft, permissions: [] }, NOW)).toMatch(/permission/);
    expect(draftProblem({ ...draft, groupIds: [] }, NOW)).toMatch(/group/);
    expect(draftProblem({ ...draft, expiresAt: '' }, NOW)).toMatch(/ends/);
    expect(draftProblem({ ...draft, expiresAt: local(NOW - DAY) }, NOW)).toMatch(/future/);
  });

  it('needs a reason only for every channel\'s messages', () => {
    const wide = { ...draft, groupIds: null, permissions: ['messages:read'] };
    expect(needsReason(wide)).toBe(true);
    expect(needsReason({ ...wide, groupIds: ['g1'] })).toBe(false);
    expect(draftProblem(wide, NOW)).toMatch(/Say why/);
    expect(draftProblem({ ...wide, reason: 'Nightly extract' }, NOW)).toBeNull();
  });

  it('sends trimmed text, the end as an instant, and a reason only when the form asks for one', () => {
    const input = toIssueInput(draft);
    expect(input).toMatchObject({ name: 'Lab feed', permissions: ['channels:read'], groupIds: ['g1'], reason: null });
    expect(Math.abs(Date.parse(input.expiresAt) - (NOW + 30 * DAY))).toBeLessThan(60_000);
    const wide = { ...draft, groupIds: null, permissions: ['messages:read'] };
    expect(toIssueInput({ ...wide, reason: ' Why ' }).reason).toBe('Why');
    // Typed, then hidden by a scope change: not sent, so it cannot get the issue refused.
    expect(toIssueInput({ ...draft, reason: 'ab' }).reason).toBeNull();
  });
});
