// ===========================================
// Test helper: a user's standing as the resolver returns it
// ===========================================
// Unit tests mock lib/principal.ts (the database boundary for who a user is and
// what they hold) with this, giving the user one all-channel assignment of the
// built-in role named in `role`, or none.

import { ALL_CHANNELS, foldGrants } from '@galvanigraph/core-models';
import { builtInRolePermissions } from '../src/db/seeds/roles.js';
import type { UserStanding } from '../src/lib/principal.js';

export interface StandingRow {
  readonly id: string;
  readonly username?: string;
  readonly email?: string;
  readonly enabled?: boolean;
  readonly mustChangePassword?: boolean;
  /** A built-in role's name; omitted, the user holds nothing. */
  readonly role?: string;
}

export function standingFor(row: StandingRow): UserStanding {
  const permissions = row.role === undefined ? [] : builtInRolePermissions(row.role);
  const grants = foldGrants(row.role === undefined ? [] : [{ permissions, scope: ALL_CHANNELS }], new Date());
  return {
    id: row.id,
    username: row.username ?? 'user',
    email: row.email ?? 'user@example.test',
    enabled: row.enabled ?? true,
    mustChangePassword: row.mustChangePassword ?? false,
    roles: row.role === undefined ? [] : [row.role],
    grants,
    permissions: [...grants.keys()].sort(),
  };
}
