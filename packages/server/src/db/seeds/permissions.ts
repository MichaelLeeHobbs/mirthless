// ===========================================
// Default Permissions
// ===========================================
// Seed rows for the permission strings defined in core-models (PERMISSIONS).

import { PERMISSIONS, type Permission } from '@galvaniflow/core-models';

export interface PermissionDefinition {
  readonly name: Permission;
  readonly resource: string;
  readonly action: string;
}

/** One seed row per permission, its name split into resource and action. */
export const defaultPermissions: readonly PermissionDefinition[] = Object.values(PERMISSIONS).map((name) => {
  const [resource = '', action = ''] = name.split(':');
  return { name, resource, action };
});
