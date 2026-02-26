// ===========================================
// Default Permissions
// ===========================================
// Mirthless-specific permissions using resource:action naming.

export const PERMISSIONS = {
  // Channels
  CHANNELS_READ: 'channels:read',
  CHANNELS_WRITE: 'channels:write',
  CHANNELS_DEPLOY: 'channels:deploy',
  CHANNELS_DELETE: 'channels:delete',

  // Messages
  MESSAGES_READ: 'messages:read',
  MESSAGES_REPROCESS: 'messages:reprocess',
  MESSAGES_DELETE: 'messages:delete',

  // Code Templates
  CODE_TEMPLATES_READ: 'code_templates:read',
  CODE_TEMPLATES_WRITE: 'code_templates:write',
  CODE_TEMPLATES_DELETE: 'code_templates:delete',

  // Alerts
  ALERTS_READ: 'alerts:read',
  ALERTS_WRITE: 'alerts:write',
  ALERTS_DELETE: 'alerts:delete',

  // Users
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DELETE: 'users:delete',

  // Settings
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',

  // Events
  EVENTS_READ: 'events:read',

  // Resources
  RESOURCES_READ: 'resources:read',
  RESOURCES_WRITE: 'resources:write',
  RESOURCES_DELETE: 'resources:delete',

  // Global Scripts
  GLOBAL_SCRIPTS_READ: 'global_scripts:read',
  GLOBAL_SCRIPTS_WRITE: 'global_scripts:write',

  // Global Map
  GLOBAL_MAP_READ: 'global_map:read',
  GLOBAL_MAP_WRITE: 'global_map:write',

  // Config Map
  CONFIG_MAP_READ: 'config_map:read',
  CONFIG_MAP_WRITE: 'config_map:write',

  // System
  SYSTEM_INFO: 'system:info',
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_RESTORE: 'system:restore',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  readonly name: string;
  readonly resource: string;
  readonly action: string;
}

export const defaultPermissions: readonly PermissionDefinition[] = [
  // Channels
  { name: PERMISSIONS.CHANNELS_READ, resource: 'channels', action: 'read' },
  { name: PERMISSIONS.CHANNELS_WRITE, resource: 'channels', action: 'write' },
  { name: PERMISSIONS.CHANNELS_DEPLOY, resource: 'channels', action: 'deploy' },
  { name: PERMISSIONS.CHANNELS_DELETE, resource: 'channels', action: 'delete' },

  // Messages
  { name: PERMISSIONS.MESSAGES_READ, resource: 'messages', action: 'read' },
  { name: PERMISSIONS.MESSAGES_REPROCESS, resource: 'messages', action: 'reprocess' },
  { name: PERMISSIONS.MESSAGES_DELETE, resource: 'messages', action: 'delete' },

  // Code Templates
  { name: PERMISSIONS.CODE_TEMPLATES_READ, resource: 'code_templates', action: 'read' },
  { name: PERMISSIONS.CODE_TEMPLATES_WRITE, resource: 'code_templates', action: 'write' },
  { name: PERMISSIONS.CODE_TEMPLATES_DELETE, resource: 'code_templates', action: 'delete' },

  // Alerts
  { name: PERMISSIONS.ALERTS_READ, resource: 'alerts', action: 'read' },
  { name: PERMISSIONS.ALERTS_WRITE, resource: 'alerts', action: 'write' },
  { name: PERMISSIONS.ALERTS_DELETE, resource: 'alerts', action: 'delete' },

  // Users
  { name: PERMISSIONS.USERS_READ, resource: 'users', action: 'read' },
  { name: PERMISSIONS.USERS_WRITE, resource: 'users', action: 'write' },
  { name: PERMISSIONS.USERS_DELETE, resource: 'users', action: 'delete' },

  // Settings
  { name: PERMISSIONS.SETTINGS_READ, resource: 'settings', action: 'read' },
  { name: PERMISSIONS.SETTINGS_WRITE, resource: 'settings', action: 'write' },

  // Events
  { name: PERMISSIONS.EVENTS_READ, resource: 'events', action: 'read' },

  // Resources
  { name: PERMISSIONS.RESOURCES_READ, resource: 'resources', action: 'read' },
  { name: PERMISSIONS.RESOURCES_WRITE, resource: 'resources', action: 'write' },
  { name: PERMISSIONS.RESOURCES_DELETE, resource: 'resources', action: 'delete' },

  // Global Scripts
  { name: PERMISSIONS.GLOBAL_SCRIPTS_READ, resource: 'global_scripts', action: 'read' },
  { name: PERMISSIONS.GLOBAL_SCRIPTS_WRITE, resource: 'global_scripts', action: 'write' },

  // Global Map
  { name: PERMISSIONS.GLOBAL_MAP_READ, resource: 'global_map', action: 'read' },
  { name: PERMISSIONS.GLOBAL_MAP_WRITE, resource: 'global_map', action: 'write' },

  // Config Map
  { name: PERMISSIONS.CONFIG_MAP_READ, resource: 'config_map', action: 'read' },
  { name: PERMISSIONS.CONFIG_MAP_WRITE, resource: 'config_map', action: 'write' },

  // System
  { name: PERMISSIONS.SYSTEM_INFO, resource: 'system', action: 'info' },
  { name: PERMISSIONS.SYSTEM_BACKUP, resource: 'system', action: 'backup' },
  { name: PERMISSIONS.SYSTEM_RESTORE, resource: 'system', action: 'restore' },
];
