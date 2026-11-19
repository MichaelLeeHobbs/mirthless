// The database half (one query, expiry filtered in SQL) is proven against
// Postgres in test/integration/role-migration.itest.ts and route-walk.itest.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { warn, error } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ default: { warn, error, info: vi.fn(), debug: vi.fn() } }));
vi.mock('../db.js', () => ({ db: {} }));

import { PERMISSIONS, ALL_CHANNELS } from '@galvanigraph/core-models';
import { toAssignmentGrants, queryUserStanding, roleLabel, nextExpiryOf } from '../principal.js';

const USER = '00000000-0000-4000-8000-000000000001';

function executorReturning(rows: readonly unknown[]): Parameters<typeof queryUserStanding>[0] {
  const chain = { from: () => chain, where: () => Promise.resolve(rows) };
  return { select: () => chain } as unknown as Parameters<typeof queryUserStanding>[0];
}

beforeEach(() => {
  warn.mockReset();
  error.mockReset();
});

describe('toAssignmentGrants', () => {
  it('gives the admin role every permission, whatever rows it has', () => {
    const held = toAssignmentGrants(USER, [{ role: 'admin', admin: true, permissions: [], expiresAt: null, allChannels: true }]);
    expect(held.grants[0]?.permissions).toEqual(Object.values(PERMISSIONS));
    expect(held.grants[0]?.scope).toBe(ALL_CHANNELS);
    expect(held.roles).toEqual(['admin']);
  });

  it('ignores and logs a permission the server does not know', () => {
    const held = toAssignmentGrants(USER, [{ role: 'old', admin: false, permissions: ['channels:read', 'tags:write'], expiresAt: null, allChannels: true }]);
    expect(held.grants[0]?.permissions).toEqual(['channels:read']);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ unknown: ['tags:write'] }), expect.any(String));
  });

  it('fails closed on rows it cannot read', () => {
    expect(toAssignmentGrants(USER, [{ role: 1 }])).toEqual({ roles: [], grants: [] });
    expect(toAssignmentGrants(USER, 'nonsense')).toEqual({ roles: [], grants: [] });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('scopes a group assignment to its groups', () => {
    const held = toAssignmentGrants(USER, [{ role: 'lab', admin: false, permissions: ['messages:read'], expiresAt: null, allChannels: false, groupIds: ['g-lab'] }]);
    expect(held.grants[0]?.scope).toEqual(['g-lab']);
  });

  it('fails closed on a row that does not say whether it covers every channel', () => {
    expect(toAssignmentGrants(USER, [{ role: 'lab', admin: false, permissions: ['messages:read'], expiresAt: null }])).toEqual({ roles: [], grants: [] });
  });

  it('carries each assignment\'s expiry, and names each role once', () => {
    const held = toAssignmentGrants(USER, [
      { role: 'viewer', admin: false, permissions: ['channels:read'], expiresAt: '2026-12-01T00:00:00Z', allChannels: true },
      { role: 'viewer', admin: false, permissions: ['channels:read'], expiresAt: null, allChannels: true },
    ]);
    expect(held.grants.map((g) => g.expiresAt)).toEqual([new Date('2026-12-01T00:00:00Z'), null]);
    expect(held.roles).toEqual(['viewer']);
  });
});

describe('queryUserStanding', () => {
  const row = {
    id: USER, username: 'ann', email: 'ann@example.test', enabled: true, mustChangePassword: false,
    assignments: [
      { role: 'viewer', admin: false, permissions: ['messages:read', 'channels:read'], expiresAt: null, allChannels: true },
      { role: 'deployer', admin: false, permissions: ['channels:deploy'], expiresAt: '2026-11-16T11:00:00Z', allChannels: true },
    ],
  };

  it('folds live assignments into sorted permissions and role names', async () => {
    const standing = await queryUserStanding(executorReturning([row]), USER, new Date('2026-11-16T10:00:00Z'));
    expect(standing?.permissions).toEqual(['channels:deploy', 'channels:read', 'messages:read']);
    expect(standing?.roles).toEqual(['deployer', 'viewer']);
    expect(standing?.grants.get('channels:read')).toBe(ALL_CHANNELS);
  });

  it('drops an assignment that expired after the query ran', async () => {
    const standing = await queryUserStanding(executorReturning([row]), USER, new Date('2026-11-16T12:00:00Z'));
    expect(standing?.permissions).toEqual(['channels:read', 'messages:read']);
  });

  it('returns null for a user that does not exist', async () => {
    expect(await queryUserStanding(executorReturning([]), USER)).toBeNull();
  });
});

describe('nextExpiryOf', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const at = (iso: string | null): { permissions: []; scope: typeof ALL_CHANNELS; expiresAt: Date | null } =>
    ({ permissions: [], scope: ALL_CHANNELS, expiresAt: iso === null ? null : new Date(iso) });

  it('is the earliest end time still ahead', () => {
    expect(nextExpiryOf([at('2026-11-18T00:00:00Z'), at(null), at('2026-11-17T13:00:00Z')], now)?.toISOString()).toBe('2026-11-17T13:00:00.000Z');
  });

  it('ignores an end time already past, and is null when nothing ends', () => {
    expect(nextExpiryOf([at('2026-11-17T11:00:00Z'), at(null)], now)).toBeNull();
    expect(nextExpiryOf([], now)).toBeNull();
  });
});

describe('roleLabel', () => {
  it('joins role names for screens that show one role', () => {
    expect(roleLabel(['deployer', 'viewer'])).toBe('deployer, viewer');
    expect(roleLabel([])).toBe('');
  });
});
