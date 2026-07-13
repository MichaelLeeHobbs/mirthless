// ===========================================
// Permission Strings (UI mirror)
// ===========================================
// These MUST stay in sync with the server's permission constants in
// packages/server/src/db/seeds/permissions.ts (resource:action naming).
// Used purely for UI gating — the server enforces the real authorization.

export const PERMISSION = {
  CHANNELS_READ: 'channels:read',
  CHANNELS_WRITE: 'channels:write',
  CHANNELS_DEPLOY: 'channels:deploy',
  CHANNELS_DELETE: 'channels:delete',

  MESSAGES_READ: 'messages:read',
  MESSAGES_REPROCESS: 'messages:reprocess',
  MESSAGES_DELETE: 'messages:delete',

  CODE_TEMPLATES_READ: 'code_templates:read',
  CODE_TEMPLATES_WRITE: 'code_templates:write',
  CODE_TEMPLATES_DELETE: 'code_templates:delete',

  ALERTS_READ: 'alerts:read',
  ALERTS_WRITE: 'alerts:write',
  ALERTS_DELETE: 'alerts:delete',

  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DELETE: 'users:delete',

  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',

  EVENTS_READ: 'events:read',

  RESOURCES_READ: 'resources:read',
  RESOURCES_WRITE: 'resources:write',
  RESOURCES_DELETE: 'resources:delete',

  COLLECTIONS_READ: 'collections:read',
  COLLECTIONS_WRITE: 'collections:write',
  COLLECTIONS_DELETE: 'collections:delete',

  GLOBAL_SCRIPTS_READ: 'global_scripts:read',
  GLOBAL_SCRIPTS_WRITE: 'global_scripts:write',

  GLOBAL_MAP_READ: 'global_map:read',
  GLOBAL_MAP_WRITE: 'global_map:write',

  CONFIG_MAP_READ: 'config_map:read',
  CONFIG_MAP_WRITE: 'config_map:write',

  SYSTEM_INFO: 'system:info',
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_RESTORE: 'system:restore',
} as const;

export type PermissionString = (typeof PERMISSION)[keyof typeof PERMISSION];
