// ===========================================
// Default Roles
// ===========================================
// Maps roles to permission sets.

import { PERMISSIONS } from './permissions.js';

export const ROLES = {
  ADMIN: 'admin',
  DEPLOYER: 'deployer',
  DEVELOPER: 'developer',
  VIEWER: 'viewer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export interface RoleDefinition {
  readonly name: string;
  readonly permissions: readonly string[];
}

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const defaultRoles: readonly RoleDefinition[] = [
  {
    name: ROLES.ADMIN,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: ROLES.DEPLOYER,
    permissions: [
      PERMISSIONS.CHANNELS_READ,
      PERMISSIONS.CHANNELS_WRITE,
      PERMISSIONS.CHANNELS_DEPLOY,
      PERMISSIONS.MESSAGES_READ,
      PERMISSIONS.MESSAGES_REPROCESS,
      PERMISSIONS.CODE_TEMPLATES_READ,
      PERMISSIONS.CODE_TEMPLATES_WRITE,
      PERMISSIONS.CODE_TEMPLATES_DELETE,
      PERMISSIONS.ALERTS_READ,
      PERMISSIONS.ALERTS_WRITE,
      PERMISSIONS.ALERTS_DELETE,
      PERMISSIONS.EVENTS_READ,
      PERMISSIONS.RESOURCES_READ,
      PERMISSIONS.RESOURCES_WRITE,
      PERMISSIONS.RESOURCES_DELETE,
      PERMISSIONS.GLOBAL_SCRIPTS_READ,
      PERMISSIONS.GLOBAL_MAP_READ,
      PERMISSIONS.CONFIG_MAP_READ,
      PERMISSIONS.SYSTEM_INFO,
    ],
  },
  {
    name: ROLES.DEVELOPER,
    permissions: [
      PERMISSIONS.CHANNELS_READ,
      PERMISSIONS.CHANNELS_WRITE,
      PERMISSIONS.MESSAGES_READ,
      PERMISSIONS.CODE_TEMPLATES_READ,
      PERMISSIONS.CODE_TEMPLATES_WRITE,
      PERMISSIONS.ALERTS_READ,
      PERMISSIONS.EVENTS_READ,
      PERMISSIONS.RESOURCES_READ,
      PERMISSIONS.RESOURCES_WRITE,
      PERMISSIONS.GLOBAL_SCRIPTS_READ,
      PERMISSIONS.GLOBAL_MAP_READ,
      PERMISSIONS.CONFIG_MAP_READ,
    ],
  },
  {
    name: ROLES.VIEWER,
    permissions: [
      PERMISSIONS.CHANNELS_READ,
      PERMISSIONS.MESSAGES_READ,
      PERMISSIONS.CODE_TEMPLATES_READ,
      PERMISSIONS.ALERTS_READ,
      PERMISSIONS.EVENTS_READ,
      PERMISSIONS.RESOURCES_READ,
    ],
  },
];
