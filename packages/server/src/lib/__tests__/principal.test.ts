// ===========================================
// Principal resolver: stored assignments to grants
// ===========================================
// The database half (one query, expiry filtered in SQL) is proven against
// Postgres in test/integration/role-migration.itest.ts and route-walk.itest.ts.
// This covers what the resolver does with the rows it gets back.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { warn, error } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ default: { warn, error, info: vi.fn(), debug: vi.fn() } }));
vi.mock('../db.js', () => ({ db: {} }));

import { PERMISSIONS, ALL_CHANNELS } from '@galvanigraph/core-models';
import { toAssignmentGrants, queryUserStanding, roleLabel } from '../principal.js';

const USER = '00000000-0000-4000-8000-000000000001';

/** An executor whose select() resolves to `rows`, as Drizzle's builder does. */
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
    const held = toAssignmentGrants(USER, [{ role: 'admin', admin: true, permissions: [], expiresAt: null }]);
    expect(held.grants[0]?.permissions).toEqual(Object.values(PERMISSIONS));
    expect(held.grants[0]?.scope).toBe(ALL_CHANNELS);
    expect(held.roles).toEqual(['admin']);
  });

  it('ignores and logs a permission the server does not know', () => {
    const held = toAssignmentGrants(USER, [{ role: 'old', admin: false, permissions: ['channels:read', 'tags:write'], expiresAt: null }]);
    expect(held.grants[0]?.permissions).toEqual(['channels:read']);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ unknown: ['tags:write'] }), expect.any(String));
  });

  it('fails closed on rows it cannot read', () => {
    expect(toAssignmentGrants(USER, [{ role: 1 }])).toEqual({ roles: [], grants: [] });
    expect(toAssignmentGrants(USER, 'nonsense')).toEqual({ roles: [], grants: [] });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('carries each assignment\'s expiry, and names each role once', () => {
    const held = toAssignmentGrants(USER, [
      { role: 'viewer', admin: false, permissions: ['channels:read'], expiresAt: '2026-12-01T00:00:00Z' },
      { role: 'viewer', admin: false, permissions: ['channels:read'], expiresAt: null },
    ]);
    expect(held.grants.map((g) => g.expiresAt)).toEqual([new Date('2026-12-01T00:00:00Z'), null]);
    expect(held.roles).toEqual(['viewer']);
  });
});

describe('queryUserStanding', () => {
  const row = {
    id: USER, username: 'ann', email: 'ann@example.test', enabled: true, mustChangePassword: false,
    assignments: [
      { role: 'viewer', admin: false, permissions: ['messages:read', 'channels:read'], expiresAt: null },
      { role: 'deployer', admin: false, permissions: ['channels:deploy'], expiresAt: '2026-11-16T11:00:00Z' },
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

describe('roleLabel', () => {
  it('joins role names for screens that show one role', () => {
    expect(roleLabel(['deployer', 'viewer'])).toBe('deployer, viewer');
    expect(roleLabel([])).toBe('');
  });
});
