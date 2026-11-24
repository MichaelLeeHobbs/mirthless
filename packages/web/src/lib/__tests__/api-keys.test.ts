import { describe, expect, it } from 'vitest';
import type { ApiKeyView } from '@galvanigraph/core-models';
import { coversKey, draftProblem, keyScopeLabel, liveKeysIssuedBy, needsReason, toIssueInput, type KeyDraft } from '../api-keys.js';
import { toDateTimeLocal } from '../datetime-local.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const DAY = 86_400_000;

function key(over: Partial<ApiKeyView>): ApiKeyView {
  return {
    id: 'k', name: 'Feed', description: '', permissions: ['channels:read'], groupIds: null, status: 'active',
    expiresAt: '2027-01-01T00:00:00.000Z', reason: null, issuedBy: { id: 'u1', username: 'priya' },
    revokedAt: null, revokeReason: null, lastUsedAt: null, lastUsedIp: null, createdAt: '2026-11-01T00:00:00.000Z',
    previousSecretUntil: null, ...over,
  };
}

const local = (ms: number): string => toDateTimeLocal(new Date(ms).toISOString());

describe('liveKeysIssuedBy', () => {
  it('lists the working keys a user issued: offboarding acts on no other', () => {
    const keys = [
      key({ id: 'a' }), key({ id: 'b', status: 'disabled' }), key({ id: 'c', status: 'revoked' }),
      key({ id: 'd', status: 'expired' }), key({ id: 'e', issuedBy: { id: 'u2', username: 'x' } }),
    ];
    expect(liveKeysIssuedBy(keys, 'u1').map((k) => k.id)).toEqual(['a']);
  });
});

/** coversKey over plain group ids, as the sign-in answer carries them. */
const covers = coversKey as (grants: ReadonlyArray<{ permission: string; scope: 'all' | readonly string[] }> | undefined, key: ApiKeyView) => boolean;

describe('coversKey', () => {
  const lab = key({ permissions: ['channels:read', 'channels:deploy'], groupIds: ['g1'] });

  it('needs every permission the key holds, over its scope', () => {
    expect(covers([{ permission: 'channels:read', scope: 'all' }, { permission: 'channels:deploy', scope: 'all' }], lab)).toBe(true);
    expect(covers([{ permission: 'channels:read', scope: ['g1', 'g2'] }, { permission: 'channels:deploy', scope: ['g1'] }], lab)).toBe(true);
    expect(covers([{ permission: 'channels:read', scope: 'all' }], lab)).toBe(false);
    expect(covers([{ permission: 'channels:read', scope: ['g2'] }, { permission: 'channels:deploy', scope: ['g1'] }], lab)).toBe(false);
  });

  it('needs every channel for a key on every channel, and nothing without grants', () => {
    const everywhere = key({ permissions: ['channels:read'], groupIds: null });
    expect(covers([{ permission: 'channels:read', scope: ['g1'] }], everywhere)).toBe(false);
    expect(covers([{ permission: 'channels:read', scope: 'all' }], everywhere)).toBe(true);
    expect(covers(undefined, everywhere)).toBe(false);
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
