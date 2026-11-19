// The roles the product ships (D-310). Migration 0018 creates them as rows, and
// after that the rows are the truth: an admin may edit every built-in role but
// Admin. role-migration.itest.ts checks that the migration wrote exactly these.

import { PERMISSIONS, USER_ROLE, allChannelsOnly, type Permission } from '@galvanigraph/core-models';

export interface RoleDefinition {
  readonly name: string;
  readonly description: string;
  /** The locked admin role: every permission, held without role_permissions rows. */
  readonly admin: boolean;
  readonly permissions: readonly Permission[];
}

const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

const DEPLOYER: readonly Permission[] = [
  PERMISSIONS.CHANNELS_READ, PERMISSIONS.CHANNELS_WRITE, PERMISSIONS.CHANNELS_DEPLOY,
  PERMISSIONS.MESSAGES_READ, PERMISSIONS.MESSAGES_REPROCESS,
  PERMISSIONS.CODE_TEMPLATES_READ, PERMISSIONS.CODE_TEMPLATES_WRITE, PERMISSIONS.CODE_TEMPLATES_DELETE,
  PERMISSIONS.ALERTS_READ, PERMISSIONS.ALERTS_WRITE, PERMISSIONS.ALERTS_DELETE,
  PERMISSIONS.EVENTS_READ,
  PERMISSIONS.RESOURCES_READ, PERMISSIONS.RESOURCES_WRITE, PERMISSIONS.RESOURCES_DELETE,
  PERMISSIONS.COLLECTIONS_READ, PERMISSIONS.COLLECTIONS_WRITE, PERMISSIONS.COLLECTIONS_DELETE,
  PERMISSIONS.DATASOURCES_READ, PERMISSIONS.DATASOURCES_WRITE, PERMISSIONS.DATASOURCES_DELETE,
  PERMISSIONS.GLOBAL_SCRIPTS_READ, PERMISSIONS.GLOBAL_MAP_READ, PERMISSIONS.CONFIG_MAP_READ,
  PERMISSIONS.SYSTEM_INFO,
];

const DEVELOPER: readonly Permission[] = [
  PERMISSIONS.CHANNELS_READ, PERMISSIONS.CHANNELS_WRITE,
  PERMISSIONS.MESSAGES_READ,
  PERMISSIONS.CODE_TEMPLATES_READ, PERMISSIONS.CODE_TEMPLATES_WRITE,
  PERMISSIONS.ALERTS_READ,
  PERMISSIONS.EVENTS_READ,
  PERMISSIONS.RESOURCES_READ, PERMISSIONS.RESOURCES_WRITE,
  PERMISSIONS.COLLECTIONS_READ, PERMISSIONS.COLLECTIONS_WRITE,
  PERMISSIONS.DATASOURCES_READ,
  PERMISSIONS.GLOBAL_SCRIPTS_READ, PERMISSIONS.GLOBAL_MAP_READ, PERMISSIONS.CONFIG_MAP_READ,
];

const VIEWER: readonly Permission[] = [
  PERMISSIONS.CHANNELS_READ,
  PERMISSIONS.MESSAGES_READ,
  PERMISSIONS.CODE_TEMPLATES_READ,
  PERMISSIONS.ALERTS_READ,
  PERMISSIONS.EVENTS_READ,
  PERMISSIONS.RESOURCES_READ,
  PERMISSIONS.COLLECTIONS_READ,
  PERMISSIONS.DATASOURCES_READ,
];

/** A role's permissions without those only an all-channel assignment may hold: what a channel role may grant. */
function channelOnly(permissions: readonly Permission[]): readonly Permission[] {
  return permissions.filter((p) => !allChannelsOnly(p));
}

export const CHANNEL_ROLE = {
  VIEWER: 'channel-viewer',
  DEVELOPER: 'channel-developer',
  DEPLOYER: 'channel-deployer',
} as const;

export const defaultRoles: readonly RoleDefinition[] = [
  { name: USER_ROLE.ADMIN, description: 'Every permission on every channel. Locked.', admin: true, permissions: ALL_PERMISSIONS },
  { name: USER_ROLE.DEPLOYER, description: 'Builds, deploys and runs channels, and manages the shared areas they use.', admin: false, permissions: DEPLOYER },
  { name: USER_ROLE.DEVELOPER, description: 'Builds channels and code templates; cannot deploy.', admin: false, permissions: DEVELOPER },
  { name: USER_ROLE.VIEWER, description: 'Reads channels, messages and settings; changes nothing.', admin: false, permissions: VIEWER },
  { name: CHANNEL_ROLE.VIEWER, description: 'Viewer without the reads that reach every channel, for an assignment scoped to channel groups.', admin: false, permissions: channelOnly(VIEWER) },
  { name: CHANNEL_ROLE.DEVELOPER, description: 'Developer without the permissions limited to all-channel assignments, for an assignment scoped to channel groups.', admin: false, permissions: channelOnly(DEVELOPER) },
  { name: CHANNEL_ROLE.DEPLOYER, description: 'Deployer without the permissions limited to all-channel assignments, for an assignment scoped to channel groups.', admin: false, permissions: channelOnly(DEPLOYER) },
];

/** Empty for a name that is not a built-in role. For tests and docs guards. */
export function builtInRolePermissions(name: string): readonly Permission[] {
  return defaultRoles.find((r) => r.name === name)?.permissions ?? [];
}
