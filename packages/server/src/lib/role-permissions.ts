// ===========================================
// Role → Permission Resolution
// ===========================================
// Single source of truth mapping a user's role to the concrete
// (resource, action) permission rows stored in the user_permissions table.
// Derived from `defaultRoles` (db/seeds/roles.ts) so the seed and the runtime
// user-management path can never drift apart.

import { defaultRoles, ROLES, type Role } from '../db/seeds/roles.js';

export interface PermissionRow {
  readonly resource: string;
  readonly action: string;
}

const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.values(ROLES));

/** Type guard: is the given string one of the known roles. */
export function isKnownRole(role: string): role is Role {
  return KNOWN_ROLES.has(role);
}

/**
 * Resolve the permission rows a role should be granted.
 *
 * Splits each `resource:action` permission name into its columns. Unknown roles
 * resolve to an empty set (least privilege) rather than throwing — callers get a
 * user with no permissions, which fails loudly at the first guarded route.
 */
export function permissionRowsForRole(role: string): readonly PermissionRow[] {
  const def = defaultRoles.find((r) => r.name === role);
  if (!def) {
    return [];
  }

  const rows: PermissionRow[] = [];
  for (const name of def.permissions) {
    const sep = name.indexOf(':');
    if (sep <= 0 || sep === name.length - 1) {
      continue;
    }
    rows.push({ resource: name.slice(0, sep), action: name.slice(sep + 1) });
  }
  return rows;
}

/** Resolve the flat `resource:action` permission names for a role. */
export function permissionNamesForRole(role: string): readonly string[] {
  return permissionRowsForRole(role).map((r) => `${r.resource}:${r.action}`);
}
