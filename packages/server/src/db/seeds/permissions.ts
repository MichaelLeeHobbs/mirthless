// ===========================================
// Default Permissions
// ===========================================
// Seed rows for the permission strings defined in core-models (PERMISSIONS).

import { PERMISSIONS, type Permission } from '@galvanigraph/core-models';
import { permissionRow } from '../../lib/role-permissions.js';

export interface PermissionDefinition {
  readonly name: Permission;
  readonly resource: string;
  readonly action: string;
}

/** One seed row per permission, its name split into resource and action. */
export const defaultPermissions: readonly PermissionDefinition[] = Object.values(PERMISSIONS).flatMap((name) => {
  const row = permissionRow(name);
  return row ? [{ name, ...row }] : [];
});
