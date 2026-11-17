import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRANT_REPLAY_ACTIONS, replayGrants, type GrantAuditRow } from '../grant-replay.js';

const ROLE = '00000000-0000-4000-8000-000000000001';
const ADMIN = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000010';
const CHANNEL = '00000000-0000-4000-8000-000000000020';
const GROUP = '00000000-0000-4000-8000-000000000030';

const baseline = {
  roles: [
    { id: ROLE, name: 'viewer', admin: false, permissions: ['channels:read'] },
    { id: ADMIN, name: 'admin', admin: true, permissions: [] },
  ],
  assignments: [{ userId: USER, roleId: ROLE, groupIds: null, expiresAt: null }],
  memberships: [{ channelId: CHANNEL, groupIds: [GROUP] }],
  disabledUserIds: [],
};

function row(action: string, attributes: Record<string, unknown>, channelId: string | null = null): GrantAuditRow {
  return { id: 1, action, channelId, attributes };
}

describe('replayGrants', () => {
  it('starts from the baseline', () => {
    const state = replayGrants(baseline, []);
    expect(state.roles.get(ROLE)).toEqual({ name: 'viewer', admin: false, permissions: ['channels:read'] });
    expect(state.assignments.get(USER)).toEqual([{ roleId: ROLE, groupIds: null, expiresAt: null }]);
    expect(state.memberships.get(CHANNEL)).toEqual([GROUP]);
    expect(state.disabled.size).toBe(0);
  });

  it('applies a role edit, then an assignment that names the renamed role', () => {
    const state = replayGrants(baseline, [
      row('ROLE_UPDATED', { roleId: ROLE, before: { name: 'viewer', permissions: ['channels:read'] }, after: { name: 'reader', permissions: ['channels:read', 'messages:read'] } }),
      row('ASSIGNMENTS_CHANGED', { targetUserId: USER, before: [], after: [{ role: 'reader', scope: [GROUP], expiresAt: '2026-12-01T00:00:00.000Z', reason: null }] }),
    ]);
    expect(state.roles.get(ROLE)?.permissions).toEqual(['channels:read', 'messages:read']);
    expect(state.assignments.get(USER)).toEqual([{ roleId: ROLE, groupIds: [GROUP], expiresAt: '2026-12-01T00:00:00.000Z' }]);
  });

  it('prefers the role id an assignment row carries over its name', () => {
    const state = replayGrants(baseline, [
      row('ASSIGNMENTS_CHANGED', { targetUserId: USER, before: [], after: [{ roleId: ADMIN, role: 'viewer', scope: 'all' }] }),
    ]);
    expect(state.assignments.get(USER)).toEqual([{ roleId: ADMIN, groupIds: null, expiresAt: null }]);
  });

  it('creates and deletes roles', () => {
    const NEW = '00000000-0000-4000-8000-000000000003';
    const created = replayGrants(baseline, [row('ROLE_CREATED', { roleId: NEW, name: 'ops', permissions: ['channels:deploy'] })]);
    expect(created.roles.get(NEW)).toEqual({ name: 'ops', admin: false, permissions: ['channels:deploy'] });
    const deleted = replayGrants(baseline, [
      row('ROLE_CREATED', { roleId: NEW, name: 'ops', permissions: [] }),
      row('ROLE_DELETED', { roleId: NEW, name: 'ops' }),
    ]);
    expect(deleted.roles.has(NEW)).toBe(false);
  });

  it('replaces a channel\'s groups and only that channel\'s', () => {
    const OTHER = '00000000-0000-4000-8000-000000000021';
    const state = replayGrants(baseline, [row('CHANNEL_GROUPS_CHANGED', { before: [], after: [] }, OTHER), row('CHANNEL_GROUPS_CHANGED', { before: [GROUP], after: [] }, CHANNEL)]);
    expect(state.memberships.get(CHANNEL)).toEqual([]);
    expect(state.memberships.get(OTHER)).toEqual([]);
  });

  it('follows a user being disabled and enabled again', () => {
    expect(replayGrants(baseline, [row('USER_ENABLED_CHANGED', { targetUserId: USER, enabled: false })]).disabled.has(USER)).toBe(true);
    expect(replayGrants({ ...baseline, disabledUserIds: [USER] }, [row('USER_ENABLED_CHANGED', { targetUserId: USER, enabled: true })]).disabled.has(USER)).toBe(false);
  });

  it('fails loudly on an assignment naming a role the replay does not know', () => {
    expect(() => replayGrants(baseline, [row('ASSIGNMENTS_CHANGED', { targetUserId: USER, before: [], after: [{ role: 'ghost', scope: 'all' }] })]))
      .toThrow(/ghost/);
  });

  it('fails loudly on a row it cannot read, naming the row', () => {
    expect(() => replayGrants(baseline, [{ id: 42, action: 'ROLE_UPDATED', channelId: null, attributes: { roleId: ROLE } }])).toThrow(/42/);
    expect(() => replayGrants(baseline, [{ id: 43, action: 'CHANNEL_GROUPS_CHANGED', channelId: null, attributes: { after: [] } }])).toThrow(/43/);
  });

  it('fails loudly on a baseline it cannot read', () => {
    expect(() => replayGrants({ roles: 'nope' }, [])).toThrow(/baseline/i);
  });

  it('reads the same actions the partial index on grant rows covers', () => {
    const migration = readFileSync(new URL('../../db/migrations/0022_grant_replay.sql', import.meta.url), 'utf8');
    const predicate = /audit_log_grant_idx[^;]*IN \(([^)]*)\)/.exec(migration)?.[1] ?? '';
    const indexed = [...predicate.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(indexed).toEqual([...GRANT_REPLAY_ACTIONS].sort());
  });

  it('ignores actions it does not replay', () => {
    expect(replayGrants(baseline, [row('USER_LOGIN', {})]).assignments.get(USER)).toHaveLength(1);
    expect(GRANT_REPLAY_ACTIONS).not.toContain('USER_LOGIN');
  });
});
